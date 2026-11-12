import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.api import eligibility
from app.discovery import (DiscoveryChange, ReviewChange, exclusion, get_discovery, normal_phone,
                           records, review, run_discovery_once, save_discovery)
from app.models import CallList, DiscoveryRecord, DiscoverySettings, Job, Lead, Membership, Project
from test_postgres import as_user, tenant_data


def company(number='987654321', phone='22000000', **changes):
    return {"organisasjonsnummer": number, "navn": "Eksempelbedrift AS", "telefon": phone,
        "forretningsadresse": {"kommunenummer": "0301"}, "naeringskode1": {"kode": "62.100", "beskrivelse": "Programmering"}, **changes}


@pytest.mark.parametrize('value,expected', [('22 00 00 00','+4722000000'), ('004722000000','+4722000000'),
    ('+47 900 00 000','+4790000000'), ('+4690000000',''), ('112',''), ('abc',''), (None,'')])
def test_phone_normalization(value, expected):
    assert normal_phone(value) == expected


def test_registry_exclusions_and_industry_validation():
    assert exclusion(company(), ['62']) is None
    assert exclusion(company(konkurs=True), [])
    assert exclusion(company(reservertMotReklame=True), [])
    assert exclusion(company(forretningsadresse={'kommunenummer':'4601'}), [])
    assert exclusion(company(), ['43'])
    with pytest.raises(ValidationError):
        DiscoveryChange(enabled=True, industries=['bogus'], call_list_id=uuid4())


def test_existing_review_gets_phone_lookup_once_and_stays_blocked(configured, monkeypatch):
    from app.worker import run_once
    engine, worker, users, _, projects, _ = configured
    with client_for([company('987654322','')]) as client:
        run_discovery_once(worker,client)
    with Session(engine) as db, db.begin():
        lead=db.scalar(select(Lead).where(Lead.project_id==projects[0],Lead.review_required))
        lead_id=lead.id
        lead.enrichment={'lookup_status':'ok'}
        db.execute(text("UPDATE hub.jobs SET available_at=now()+interval '1 day' WHERE project_id=:p"), {'p':projects[0]})
    monkeypatch.setattr('app.worker.company_data',lambda *args: {'lookup_status':'ok','website_phone_status':'found',
        'website_phones':[{'phone':'+4722001122','source_url':'https://example.no/kontakt'}]})
    with httpx.Client() as client:
        assert run_once(worker,client)
        assert not run_once(worker,client)
    with as_user(engine,users[0]) as db:
        lead=db.get(Lead,lead_id)
        assert lead.review_required and not lead.phone and lead.call_list_id is None
        assert not eligibility(db,db.get(Project,projects[0]),lead)[0].allowed
        result=records(projects[0],status='review',page=0,db=db)
        assert result['items'][0]['website_phones'][0]['phone']=='+4722001122'
        review(projects[0],result['items'][0]['id'],ReviewChange(decision='approve',phone='+4722001122',confirmed_business_number=True),db)


@pytest.fixture
def configured(tenant_data):
    engine, users, partners, projects, _ = tenant_data
    with Session(engine) as db, db.begin():
        db.get(Membership, (projects[0],users[0])).role='admin'
        queue=CallList(id=uuid4(),project_id=projects[0],partner_id=partners[0],name='Discovery cold',category='cold')
        db.add(queue)
        queue_id=queue.id
    with as_user(engine, users[0]) as db:
        save_discovery(projects[0], DiscoveryChange(enabled=True, industries=['62'], call_list_id=queue_id), db)
    worker_engine=create_engine(engine.url)
    @event.listens_for(worker_engine, 'connect')
    def worker_login(connection, _):
        cursor=connection.cursor()
        cursor.execute('SET SESSION AUTHORIZATION hub_worker')
        connection.commit()
        cursor.close()
    yield engine,worker_engine,users,partners,projects,queue_id
    worker_engine.dispose()


def client_for(rows, pages=1):
    def response(req):
        assert req.url.host=='data.brreg.no'
        assert req.url.params['forretningsadresse.kommunenummer']=='0301'
        assert req.url.params['naeringskode']=='62'
        return httpx.Response(200,json={'_embedded':{'enheter':rows},'page':{'totalPages':pages}})
    return httpx.Client(transport=httpx.MockTransport(response))


def make_due(engine, project, *, previous_day=False):
    with engine.begin() as c:
        c.execute(text("UPDATE hub.discovery_settings SET next_run_at=now() WHERE project_id=:p"),{'p':project})
        if previous_day:
            c.execute(text("UPDATE hub.leads SET created_at=now()-interval '2 days' WHERE project_id=:p"),{'p':project})


def test_import_review_exclusions_and_idempotency(configured):
    engine,worker,users,partners,projects,queue=configured
    rows=[company(),company('987654322',''),company('987654323',konkurs=True),company('987654324',reservertMotReklame=True)]
    with client_for(rows) as client:
        assert run_discovery_once(worker,client)
        make_due(engine,projects[0])
        assert run_discovery_once(worker,client)
    with Session(engine) as db:
        leads=list(db.scalars(select(Lead).where(Lead.project_id==projects[0],Lead.source=='brreg_discovery')))
        assert len(leads)==2
        assert all(l.partner_id==partners[0] for l in leads)
        ready=next(l for l in leads if l.phone)
        missing=next(l for l in leads if not l.phone)
        assert ready.call_list_id==queue and not ready.review_required
        assert missing.call_list_id is None and missing.review_required
        review_id=db.scalar(select(DiscoveryRecord.id).where(DiscoveryRecord.lead_id==missing.id))
    with as_user(engine,users[0]) as db:
        decision,_=eligibility(db,db.get(Project,projects[0]),db.get(Lead,missing.id))
        assert not decision.allowed
        result=review(projects[0],review_id,ReviewChange(decision='approve',phone='22001122',confirmed_business_number=True),db)
        assert result['status']=='imported'
    with Session(engine) as db:
        reviewed=db.get(Lead,missing.id)
        assert reviewed.call_list_id==queue and not reviewed.review_required and reviewed.phone=='+4722001122'


def test_concurrent_workers_daily_cap_and_cursor(configured):
    engine,worker,users,_,projects,queue=configured
    rows=[company(str(980000000+i), '' if i%2 else '22000000') for i in range(50)]
    barrier=Barrier(2)
    def execute(_):
        with client_for(rows) as client:
            barrier.wait(timeout=10)
            return run_discovery_once(worker,client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(execute,range(2)))==1
    with as_user(engine,users[0]) as db:
        assert get_discovery(projects[0],db)['settings']['imported_today']==20
        # Changing filters or disabling/re-enabling cannot reset today's quota.
        save_discovery(projects[0],DiscoveryChange(enabled=True,industries=['62'],call_list_id=queue),db)
    with client_for(rows) as client:
        assert run_discovery_once(worker,client)
    with Session(engine) as db:
        assert len(list(db.scalars(select(Lead).where(Lead.source=='brreg_discovery',Lead.project_id==projects[0]))))==20
        assert db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id==projects[0])).offset==20
    make_due(engine,projects[0],previous_day=True)
    with client_for(rows) as client:
        assert run_discovery_once(worker,client)
    with Session(engine) as db:
        assert len(list(db.scalars(select(Lead).where(Lead.source=='brreg_discovery',Lead.project_id==projects[0]))))==40
        assert db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id==projects[0])).offset==40


def test_source_failure_keeps_cursor_and_pause_stops_work(configured):
    engine,worker,users,_,projects,queue=configured
    with httpx.Client(transport=httpx.MockTransport(lambda r:httpx.Response(503))) as client:
        assert run_discovery_once(worker,client)
    with as_user(engine,users[0]) as db:
        settings=get_discovery(projects[0],db)['settings']
        assert settings['last_error'] and settings['imported_today']==0
        save_discovery(projects[0],DiscoveryChange(enabled=False,industries=['62'],call_list_id=queue),db)
    with client_for([company()]) as client:
        assert not run_discovery_once(worker,client)


def test_scope_and_seller_cannot_configure_or_read_history(configured):
    engine,worker,users,partners,projects,queue=configured
    for user,project in [(users[1],projects[0]),(users[2],projects[0])]:
        with as_user(engine,user) as db:
            with pytest.raises(HTTPException):
                get_discovery(project,db)
            assert db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id==projects[0])) is None
            assert not list(db.scalars(select(DiscoveryRecord)))
    with as_user(engine,users[0]) as db, pytest.raises(HTTPException):
        save_discovery(projects[0],DiscoveryChange(enabled=True,industries=[],call_list_id=uuid4()),db)
    # Even direct worker SQL cannot import outside enabled project scope.
    with Session(worker) as db, pytest.raises(DBAPIError), db.begin():
        db.execute(text('SET LOCAL ROLE hub_worker'))
        db.add(Lead(project_id=projects[1],partner_id=partners[1],company='Forged',phone='+4722000000',
                    org_number='987654321',city='Oslo',source='brreg_discovery'))
        db.flush()


def test_database_guard_enforces_quota_without_python_importer(configured):
    engine,worker,_,partners,projects,queue=configured
    with client_for([company(str(980000000+i)) for i in range(20)]) as client:
        run_discovery_once(worker,client)
    with Session(worker) as db, pytest.raises(DBAPIError), db.begin():
        db.execute(text('SET LOCAL ROLE hub_worker'))
        db.add(Lead(project_id=projects[0],partner_id=partners[0],company='Over quota',phone='+4722000000',
                    org_number='987654399',city='Oslo',source='brreg_discovery',call_list_id=queue))
        db.flush()


def test_manual_duplicate_returns_conflict_and_review_rejection_is_persistent(configured):
    from app.api import create_lead
    from app.schemas import LeadCreate
    engine,worker,users,_,projects,_=configured
    with client_for([company(phone='')]) as client:
        run_discovery_once(worker,client)
    with as_user(engine,users[0]) as db:
        with pytest.raises(HTTPException) as error:
            create_lead(projects[0],LeadCreate(company='Duplicate',phone='+4722000000',org_number='987654321'),db)
        assert error.value.status_code==409
        item=db.scalar(select(DiscoveryRecord).where(DiscoveryRecord.project_id==projects[0]))
        review(projects[0],item.id,ReviewChange(decision='reject'),db)
    make_due(engine,projects[0])
    with client_for([company()]) as client:
        run_discovery_once(worker,client)
    with Session(engine) as db:
        item=db.scalar(select(DiscoveryRecord).where(DiscoveryRecord.project_id==projects[0]))
        assert item.status=='rejected'
        assert db.get(Lead,item.lead_id).status=='declined'
