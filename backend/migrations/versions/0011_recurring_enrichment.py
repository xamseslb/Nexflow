"""Schedule one recurring company lookup per existing B2B lead."""
from alembic import op

revision = "0011"
down_revision = "0010"


def upgrade():
    op.execute("""
        UPDATE hub.jobs j SET status='done' FROM (
          SELECT id, row_number() OVER (
            PARTITION BY partner_id, project_id, payload->>'lead_id' ORDER BY created_at DESC, id
          ) AS seq FROM hub.jobs WHERE kind='brreg_enrichment' AND status='pending' AND payload ? 'lead_id'
        ) d WHERE j.id=d.id AND d.seq>1;
        CREATE UNIQUE INDEX jobs_company_lead
          ON hub.jobs (partner_id, project_id, (payload->>'lead_id')) WHERE kind='brreg_enrichment' AND status='pending';
        INSERT INTO hub.jobs (id, partner_id, project_id, kind, payload, status, attempts)
          SELECT gen_random_uuid(), l.partner_id, l.project_id, 'brreg_enrichment',
                 jsonb_build_object('lead_id',l.id::text), 'pending', 0
          FROM hub.leads l WHERE l.kind='b2b' ON CONFLICT DO NOTHING;
    """)


def downgrade():
    op.execute("DROP INDEX hub.jobs_company_lead")
