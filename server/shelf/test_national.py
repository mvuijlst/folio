import json
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from . import intake, national
from .models import Book

KB_ANSWER = {'results': {'bindings': [
    {'isbn': {'value': '9789021015996'}, 'name': {'value': 'De historicus'}, 'pages': {'value': '709'}, 'lang': {'value': 'nl'},
     'publisher': {'value': 'Poema Pocket'}, 'year': {'value': '2011'}, 'author': {'value': 'Elizabeth Johnson Kostova'}},
    {'isbn': {'value': '9022309037'}, 'name': {'value': 'Een ander boek'}, 'publisher': {'value': 'Manteau'}},
]}}

BNF_ANSWER = """<srw:searchRetrieveResponse xmlns:srw="http://www.loc.gov/zing/srw/" xmlns:mxc="info:lc/xmlns/marcxchange-v2">
<srw:numberOfRecords>1</srw:numberOfRecords><srw:records><srw:record><srw:recordData><mxc:record>
<mxc:datafield tag="101" ind1="0" ind2=" "><mxc:subfield code="a">fre</mxc:subfield></mxc:datafield>
<mxc:datafield tag="200" ind1="1" ind2=" "><mxc:subfield code="a">Le seigneur des anneaux</mxc:subfield><mxc:subfield code="h">1</mxc:subfield><mxc:subfield code="i">La communauté de l'anneau</mxc:subfield></mxc:datafield>
<mxc:datafield tag="210" ind1=" " ind2=" "><mxc:subfield code="c">Gallimard-Jeunesse</mxc:subfield><mxc:subfield code="d">2007</mxc:subfield></mxc:datafield>
<mxc:datafield tag="215" ind1=" " ind2=" "><mxc:subfield code="a">1 vol. (687 p.)</mxc:subfield></mxc:datafield>
<mxc:datafield tag="700" ind1=" " ind2="|"><mxc:subfield code="a">Tolkien</mxc:subfield><mxc:subfield code="b">John Ronald Reuel</mxc:subfield></mxc:datafield>
</mxc:record></srw:recordData></srw:record></srw:records></srw:searchRetrieveResponse>"""


class ReadingTheCatalogues(SimpleTestCase):
    def test_which_catalogue(self):
        self.assertEqual([national.national_for(i) for i in ('9789021015996', '9789401403665', '9782070612888', '9791032100000', '9780141439518')],
                         ['kb', 'kb', 'bnf', 'bnf', ''])

    def test_the_kb_answers_many_and_both_isbn_forms_count(self):
        with mock.patch.object(national, 'fetch', return_value=json.dumps(KB_ANSWER)) as asked:
            got = national.kb_many(['9789021015996', '9789022309032'])
        self.assertIn('"9021015994"', asked.call_args[0][0].replace('%22', '"'))   # the ISBN-10 is asked too (url-encoded)
        self.assertEqual(got['9789021015996'], {'title': 'De historicus', 'author': 'Elizabeth Johnson Kostova', 'publisher': 'Poema Pocket',
                                                'date': '2011', 'pages': 709, 'language': 'nl'})
        self.assertEqual(got['9789022309032']['publisher'], 'Manteau')            # found by its ISBN-10

    def test_a_bnf_record(self):
        self.assertEqual(national.from_bnf(BNF_ANSWER), {
            'title': "Le seigneur des anneaux. 1, La communauté de l'anneau", 'author': 'John Ronald Reuel Tolkien',
            'publisher': 'Gallimard-Jeunesse', 'date': '2007', 'pages': 687, 'language': 'fr'})
        self.assertIsNone(national.from_bnf('<r xmlns:srw="x"><srw:numberOfRecords>0</srw:numberOfRecords></r>'))

    def test_a_proposal_takes_publisher_year_pages_and_language_but_keeps_its_writers(self):
        proposal = {'title': 'De historicus', 'authors': [{'name': 'Elizabeth Kostova', 'role': None}], 'publisher': 'Poema',
                    'year': 2008, 'pages': None, 'language': None}
        kb = {'title': 'De historicus', 'author': 'Elizabeth Johnson Kostova', 'publisher': 'Poema Pocket', 'date': '2011', 'pages': 709, 'language': 'nl'}
        with mock.patch.object(national, 'lookup', return_value=kb):
            got = intake.with_national(dict(proposal), '9789021015996')
        self.assertEqual((got['publisher'], got['year'], got['pages'], got['language']), ('Poema Pocket', 2011, 709, 'nl'))
        self.assertEqual(got['authors'], proposal['authors'])
        with mock.patch.object(national, 'lookup', return_value=kb):   # Open Library knows nothing: the KB's record
            got = intake.with_national({'title': '', 'authors': [], 'publisher': '', 'year': None, 'pages': None, 'language': None}, '9789021015996')
        self.assertEqual((got['title'], got['authors'][0]['name']), ('De historicus', 'Elizabeth Johnson Kostova'))
        with mock.patch.object(national, 'lookup', side_effect=OSError('down')):   # a catalogue that doesn't answer changes nothing
            self.assertEqual(intake.with_national(dict(proposal), '9789021015996'), proposal)


class FillFromNational(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader')
        t = timezone.now() - timedelta(days=1)

        def book(uid, edition, **extra):
            return Book.objects.create(user=self.user, uid=uid, title=uid, modified=t, changed=t,
                                       data={'id': uid, 'title': uid, 'v': 2, 'lists': {}, 'editions': [edition], **extra})
        self.empty = book('empty', {'id': 'e1', 'format': 'paper', 'isbn': '9789021015996', 'publisher': 'Mine'})
        self.linked = book('linked', {'id': 'e1', 'format': 'paper', 'isbn': '9789022309032'}, boeken='linked')
        self.english = book('english', {'id': 'e1', 'format': 'paper', 'isbn': '9780141439518'})

    def run_command(self, *args):
        out = StringIO()
        with mock.patch.object(national, 'fetch', return_value=json.dumps(KB_ANSWER)), mock.patch('time.sleep'):
            call_command('fill_from_national', '--user', 'reader', *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def test_dry_run_says_and_changes_nothing(self):
        said = self.run_command()
        self.assertIn('Would fill: 0 publisher, 1 date, 1 pages, 1 language, in 1 books.', said)
        self.assertIn('1 editions of books on the booklog were left out', said)
        self.empty.refresh_from_db()
        self.assertNotIn('pages', self.empty.data['editions'][0])

    def test_only_what_is_empty_is_filled(self):
        self.run_command('--write')
        self.empty.refresh_from_db()
        e = self.empty.data['editions'][0]
        self.assertEqual((e['publisher'], e['date'], e['pages'], e['language']), ('Mine', '2011', 709, 'nl'))   # its own publisher stays
        self.assertGreater(self.empty.changed, self.empty.modified)
        self.linked.refresh_from_db()
        self.assertNotIn('publisher', self.linked.data['editions'][0])                 # on the booklog: left alone

    def test_with_booklog_books_too(self):
        self.run_command('--write', '--booklog')
        self.linked.refresh_from_db()
        self.assertEqual(self.linked.data['editions'][0]['publisher'], 'Manteau')
