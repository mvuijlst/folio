from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

from shelf import views as shelf_views

admin.site.site_header = 'Folio'
admin.site.site_title = 'Folio'
admin.site.index_title = 'Accounts and shelves'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('shelf.urls')),
    # A public library: the app's page, opened as a visitor (nginx passes /u/ on, as /api/).
    re_path(r'^u/(?P<slug>[^/]+)/?$', shelf_views.public_page, name='public-page'),
]

if settings.DEBUG:
    # Local development: serve the PWA from the repository root on the same origin.
    # In production nginx serves those files and only /api/ and /admin/ reach Django.
    from django.views.static import serve

    APP_ROOT = settings.BASE_DIR.parent
    urlpatterns += [
        path('', serve, {'path': 'index.html', 'document_root': APP_ROOT}),
        re_path(r'^(?P<path>(?!server/).+)$', serve, {'document_root': APP_ROOT}),
    ]
