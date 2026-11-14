"""Folio sync server: accounts and a copy of each user's shelf.

Configuration comes from environment variables (see .env.example):
  DJANGO_SECRET_KEY   required in production
  DJANGO_DEBUG        "1" for local development
  DJANGO_ALLOWED_HOSTS  comma-separated, e.g. folio.yusupov.cloud
  BOEKEN_REPO_PATH    a clone of the booklog to publish to (optional)
  BOEKEN_GIT_AUTHOR   "Name <address>" for the commits made there
  BOEKEN_PUSH         "1" to push those commits (which publishes them)
  OPENAI_API_KEY      for the assistant that proposes books from a description (optional)
  OPENAI_MODEL        the model it asks
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get('DJANGO_DEBUG') == '1'
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY') or ('dev-only-insecure-key' if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError('Set DJANGO_SECRET_KEY')

ALLOWED_HOSTS = [h.strip() for h in os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if h.strip()]
CSRF_TRUSTED_ORIGINS = [f'https://{h}' for h in ALLOWED_HOSTS if h not in ('localhost', '127.0.0.1')]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'shelf',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
WSGI_APPLICATION = 'config.wsgi.application'

TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth',
        'django.contrib.messages.context_processors.messages',
    ]},
}]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
        # A request that finds the database busy waits for it (up to 20 s) rather than failing.
        'OPTIONS': {'init_command': 'PRAGMA journal_mode=WAL;', 'transaction_mode': 'IMMEDIATE', 'timeout': 20},
    }
}

# Login attempts are counted in the database so every gunicorn worker sees them.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.db.DatabaseCache',
        'LOCATION': 'cache',
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
]

LANGUAGE_CODE = 'en'
TIME_ZONE = 'Europe/Brussels'
USE_I18N = True
USE_TZ = True

# The PWA owns /static-free paths at the site root; Django's admin assets live apart.
STATIC_URL = '/django-static/'
# Publishing to the booklog (shelf/publish.py): a clone of mvuijlst/boeken that only this
# server writes to, who its commits are by, and whether they are pushed. Unset: no publishing.
BOEKEN_REPO = os.environ.get('BOEKEN_REPO_PATH') or None
BOEKEN_GIT_AUTHOR = os.environ.get('BOEKEN_GIT_AUTHOR', 'Folio <folio@localhost>')
BOEKEN_PUSH = os.environ.get('BOEKEN_PUSH') == '1'

# The assistant (shelf/intake.py) turns a few words about a book into a proposal. It asks
# a language model, with this key; without one the app doesn't offer it.
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY', '')
OPENAI_MODEL = os.environ.get('OPENAI_MODEL', 'gpt-5.5')

# Cover thumbnails are written next to the app and served from there as plain files.
COVERS_DIR = BASE_DIR.parent / 'covers'
STATIC_ROOT = BASE_DIR / 'staticfiles'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Phones stay signed in for a year.
SESSION_COOKIE_AGE = 60 * 60 * 24 * 365
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'

# One shelf can be a few thousand books with small cover thumbnails.
DATA_UPLOAD_MAX_MEMORY_SIZE = 20 * 1024 * 1024

if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'root': {'handlers': ['console'], 'level': 'WARNING'},
}
