"""What kind of book a book is: its categories, as the assistant knows it.

The app proposes categories for books that have none (Propose categories, on the books
selected). What the shelf itself says (the same series, the same writer) it works out alone;
for the rest it asks here, a batch of books at a time. Only proposals: the app shows each one
and keeps none the user doesn't tick. The categories are the booklog's own (D-055, D-057), or,
without a booklog, the ones the shelf uses.
"""
import json
import urllib.error

from django.conf import settings

from . import intake

MOST = 30   # books in one question: answered well within a request's minute

# What each category is for, as D-055 and D-057 decided; a category not named here is only listed.
GUIDE = {
    'literatuur': 'general and literary fiction, classics, poetry, plays',
    'fantasy': 'fantasy',
    'science-fiction': 'science fiction, and alternate history',
    'horror': 'horror',
    'crime': 'crime novels, detectives and thrillers',
    'romance': 'romance',
    'comic': 'comics, graphic novels, manga, strips and cartoon books: the form, with a genre beside it where one fits',
    'geschiedenis': 'history, archaeology',
    'biografie': 'biography, autobiography, memoirs, diaries',
    'wetenschap': 'science, mathematics, nature, psychology',
    'religie': 'religion, mythology, the occult',
    'taal': 'language: dictionaries, grammar, linguistics, writing',
    'design': 'design: UX, information design, typography',
    'kunst': 'art, illustration, photography, advertising',
    'koken': 'cookbooks, food and drink',
    'informatica': 'programming, software, computers',
    'non-fictie': 'non-fiction that fits nowhere else (society, politics, philosophy, travel, management)',
}

SCHEMA = {
    'type': 'object', 'additionalProperties': False, 'required': ['books'],
    'properties': {'books': {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False, 'required': ['id', 'known', 'categories'],
        'properties': {
            'id': {'type': 'string'},
            'known': {'type': 'boolean', 'description': 'true only if you know this book itself and what it is'},
            'categories': {'type': 'array', 'items': {'type': 'string'}, 'description': 'one or two, from the list; none if you cannot tell'},
        }}}},
}


def prompt(categories):
    listed = '\n'.join(f'- {slug}' + (f': {GUIDE[slug]}' if slug in GUIDE else '') for slug in sorted(categories))
    return (
        'For each book of a personal library, say which categories it belongs in. The categories are these, and no others:\n'
        f'{listed}\n'
        'Rules. One category is usually enough; two at most. A novel is its genre; a historical novel is literatuur and '
        'geschiedenis. A comic is comic, with its genre beside it where one fits (comic and horror). A book about food that '
        'is also a memoir is both. non-fictie only when nothing more specific fits. Who a book is for (children, young '
        'adults) is not a category: say what the book is.\n'
        'Known: true only if you know this book itself. If you do not, set known to false and give a category only where '
        'the title or the series unmistakably says it (a cookbook, a dictionary); otherwise give none. Never guess from the '
        'words of a title: they often mean something else.\n'
        'Answer with every book you were given, by its id.')


def ask(books, categories):
    """[{'id', 'title', 'author', 'series', 'year', 'language'}] → {id: {'categories': [slug], 'known': bool}} for the
    books the model gives a category from `categories`."""
    if not settings.OPENAI_API_KEY:
        raise intake.NotSetUp('The assistant is not set up on this server.')
    allowed = {str(c) for c in categories}
    if not allowed or not books:
        return {}

    def line(b):
        return (f"{b['id']}: {b['title']}" + (f" — {b['author']}" if b.get('author') else '')
                + (f" (series: {b['series']})" if b.get('series') else '') + (f" ({b['year']})" if b.get('year') else '')
                + (f" [{b['language']}]" if b.get('language') else ''))
    question = {
        'model': settings.OPENAI_MODEL,
        'messages': [{'role': 'system', 'content': prompt(allowed)}, {'role': 'user', 'content': '\n'.join(line(b) for b in books)}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'books', 'strict': True, 'schema': SCHEMA}},
        # Sorting a book into a category takes no deep thought; at its own pace the model can take longer than a request has.
        'reasoning_effort': 'low',
    }
    headers = {'Authorization': f'Bearer {settings.OPENAI_API_KEY}'}
    try:
        try:
            answer = intake.post_json('https://api.openai.com/v1/chat/completions', question, headers)
        except urllib.error.HTTPError as err:
            if err.code != 400:
                raise
            question.pop('reasoning_effort')   # a model that doesn't take the setting: ask without it
            answer = intake.post_json('https://api.openai.com/v1/chat/completions', question, headers)
        got = json.loads(answer['choices'][0]['message']['content'])['books']
    except urllib.error.HTTPError as err:
        raise intake.IntakeError(f'The assistant answered with an error ({err.code}).')
    except (urllib.error.URLError, OSError) as err:
        raise intake.IntakeError(f'The assistant could not be reached: {err}')
    except (ValueError, KeyError, IndexError, TypeError) as err:
        raise intake.IntakeError(f'The assistant gave an answer that could not be read: {err}')
    asked = {b['id'] for b in books}
    out = {}
    for row in got if isinstance(got, list) else []:
        uid = str(row.get('id'))
        chosen = list(dict.fromkeys(str(c) for c in row.get('categories') or [] if str(c) in allowed))[:2]
        if uid in asked and chosen:
            out[uid] = {'categories': chosen, 'known': row.get('known') is True}
    return out
