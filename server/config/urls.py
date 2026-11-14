from django.conf import settings
from django.contrib import admin
from django.urls import include, path

admin.site.site_header = 'Bookscan'
admin.site.site_title = 'Bookscan'
admin.site.index_title = 'Accounts and shelves'

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('shelf.urls')),
]

if settings.DEBUG:
    # Local development: serve the PWA from the repository root on the same origin.
    # In production nginx serves those files and only /api/ and /admin/ reach Django.
    from django.urls import re_path
    from django.views.static import serve

    APP_ROOT = settings.BASE_DIR.parent
    urlpatterns += [
        path('', serve, {'path': 'index.html', 'document_root': APP_ROOT}),
        re_path(r'^(?P<path>(?!server/).+)$', serve, {'document_root': APP_ROOT}),
    ]
