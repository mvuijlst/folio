import json
import tempfile
from pathlib import Path
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from . import intake, publish


def page(repo, kind, slug, front):
    path = Path(repo, 'site', 'content', kind, slug, '_index.md')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f'---\n{front}\n---\n', encoding='utf-8')
    return path


class PlanWordsTests(TestCase):
    def setUp(self):
        self.repo = tempfile.mkdtemp()
        page(self.repo, 'tags', 'vampieren', 'title: "vampieren"\nslug: "vampieren"')
        self.gone = page(self.repo, 'tags', 'vampiers', 'title: "vampiers"\nslug: "vampiers"\naliases: ["/tag/vampyrs/"]')
        page(self.repo, 'categories', 'geschiedenis', 'title: "geschiedenis"\nslug: "geschiedenis"')
        page(self.repo, 'tags', 'belgie', 'title: "België"\nslug: "belgie"')

    def test_a_merged_tag_page_becomes_a_redirect_and_a_name_its_title(self):
        terms = [{'kind': 'tag', 'value': 'vampieren', 'nl': 'Vampieren', 'aliases': ['vampiers']},
                 {'kind': 'category', 'value': 'geschiedenis', 'nl': 'geschiedenis', 'en': 'history'},
                 {'kind': 'tag', 'value': 'belgie', 'en': 'Belgium'}]
        plan = publish.plan_words(self.repo, terms, used_tags={'belgie'})
        self.assertEqual(plan.removals, [self.gone])
        kept = plan.files[Path(self.repo, 'site', 'content', 'tags', 'vampieren', '_index.md')]
        self.assertIn('title: "Vampieren"', kept)
        self.assertIn('aliases: ["/tag/vampyrs/", "/tag/vampiers/"]', kept)
        self.assertEqual(len(plan.files), 1)   # the category's name is as it was; an English name stays in Folio
        self.assertIn('vampiers → vampieren', plan.message)

    def test_a_tag_taken_off_every_book_loses_its_page_once_unused(self):
        terms = [{'kind': 'tag', 'value': 'belgie', 'gone': True}]
        self.assertIsNone(publish.plan_words(self.repo, terms, used_tags={'belgie'}))
        plan = publish.plan_words(self.repo, terms, used_tags=set())
        self.assertEqual([p.parent.name for p in plan.removals], ['belgie'])
        self.assertIn('weg: belgie', plan.message)

    def test_a_merged_tag_some_post_still_has_waits(self):
        terms = [{'kind': 'tag', 'value': 'vampieren', 'aliases': ['vampiers']}]
        self.assertIsNone(publish.plan_words(self.repo, terms, used_tags={'vampiers'}))


def model_says(groups):
    return {'choices': [{'message': {'content': json.dumps({'groups': groups})}}]}


@override_settings(OPENAI_API_KEY='test-key')
class EndpointTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user('reader', password='correct horse battery')
        self.client.force_login(self.user)

    def test_merge_proposals_only_name_tags_that_exist(self):
        said = [{'keep': 'draken', 'merge': ['dragons', 'made-up', 'draken'], 'why': 'Dutch and English'},
                {'keep': 'nowhere', 'merge': ['draken'], 'why': 'x'}]
        with mock.patch.object(intake, 'post_json', return_value=model_says(said)):
            res = self.client.post('/api/tag-merges', json.dumps({'tags': [{'slug': 'draken', 'books': 11}, {'slug': 'dragons', 'books': 2}]}),
                                   content_type='application/json')
        self.assertEqual(res.json(), {'groups': [{'keep': 'draken', 'merge': ['dragons'], 'why': 'Dutch and English'}]})

    def test_the_booklog_names_its_pages(self):
        repo = tempfile.mkdtemp()
        page(repo, 'tags', 'belgie', 'title: "België"\nslug: "belgie"')
        page(repo, 'categories', 'kunst', 'title: "kunst"')
        page(repo, 'series', 'discworld', 'title: "Discworld"')
        with override_settings(BOEKEN_REPO=repo):
            res = self.client.get('/api/booklog-names').json()
        self.assertEqual(res, {'categories': {'kunst': 'kunst'}, 'tags': {'belgie': 'België'}, 'series': ['Discworld']})
        with override_settings(BOEKEN_REPO=None):
            self.assertEqual(self.client.get('/api/booklog-names').json(), {'categories': None, 'tags': None, 'series': None})
