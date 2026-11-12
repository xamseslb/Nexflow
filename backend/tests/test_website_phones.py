import httpx
from app import company_site
from app.company_phone import contacts
from app.company_registry import company_data, public_facts
from test_enrichment import ORG, registry


def test_only_explicit_phones_not_org_prices_scripts_or_fax():
    phones, links = contacts('''<footer><p>Tlf: <b>455 06 925</b></p>
      <a href="tel:+4745506925">Ring oss</a><p>Org.nr. 811549312</p>
      <p>Kontonummer 22000000</p><p>Faks: <a href="tel:22001122">22001122</a></p>
      <script>Telefon: 99887766</script><p>Telefon: +46 22001122</p>
      <a href="/pages/kontakt">Kontakt oss</a><a href="https://evil.example/kontakt">Kontakt</a></footer>''', 'https://example.no/')
    assert phones == [{'phone': '+4745506925', 'source_url':'https://example.no/'}]
    assert links == ['https://example.no/pages/kontakt']


def test_contact_pages_robots_redirects_and_multiple_numbers(monkeypatch):
    visited=[]
    def fetch(url, deadline):
        visited.append(url)
        if url.endswith('robots.txt'):
            return 200,'text/plain','User-agent: *\nDisallow: /about-us'
        if url.endswith('/kontakt'):
            return 200,'text/html','<p>Telefon: 22 00 11 22</p><a href="tel:90000000">Salg</a>'
        assert url == 'https://example.no/'
        return 200,'text/html','<a href="/kontakt">Kontakt</a><a href="/about-us">Om oss</a>'
    monkeypatch.setattr(company_site,'fetch',fetch)
    data=company_site.website_data('example.no')
    assert [p['phone'] for p in data['website_phones']] == ['+4790000000','+4722001122']
    assert data['website_phone_status']=='found'
    assert 'https://example.no/about-us' not in visited
    assert all(p['source_url']=='https://example.no/kontakt' for p in data['website_phones'])


def test_cross_origin_redirect_not_followed_on_contact_page(monkeypatch):
    visited=[]
    def fetch(url,deadline):
        visited.append(url)
        if url.endswith('robots.txt'): return 404,'',''
        if url.endswith('/kontakt'): return 302,'https://another.example/contact',''
        return 200,'text/html','<a href="/kontakt">Kontakt</a>'
    monkeypatch.setattr(company_site,'fetch',fetch)
    data=company_site.website_data('example.no')
    assert data['website_phones']==[] and data['website_phone_status']=='incomplete'
    assert not any('another.example' in url for url in visited)


def test_missing_site_and_partial_refresh_preserve_source_timestamp():
    assert company_site.website_data(None)['website_phone_status']=='missing_website'
    def unavailable(_): raise httpx.ConnectError('offline')
    previous={'organization_number':ORG, 'website_phones':[{'phone':'+4722001122','source_url':'https://example.no/contact'}], 'website_checked_at':'2026-01-01'}
    with httpx.Client(transport=httpx.MockTransport(registry)) as client:
        data=company_data(ORG,client,previous,read_site=unavailable)
    assert data['website_phones']==previous['website_phones']
    assert data['website_checked_at']=='2026-01-01'
    assert data['website_phone_status']=='temporary_error'
    assert public_facts({'website_phones':[{'phone':'+4722001122','source_url':'javascript:alert(1)'}]})['website_phones']==[]
