from django.urls import path

from . import views

urlpatterns = [
    path('session', views.session, name='session'),
    path('login', views.login_view, name='login'),
    path('logout', views.logout_view, name='logout'),
    path('sync', views.sync, name='sync'),
    path('gone', views.gone, name='gone'),
    path('hardcover', views.hardcover_series, name='hardcover'),
    path('cover', views.cover, name='cover'),
    path('suggest', views.suggest, name='suggest'),
    path('translate', views.translate, name='translate'),
    path('original', views.original_of, name='original'),
    path('pages', views.pages_of, name='pages'),
    path('categories', views.categories_of, name='categories'),
    path('booklog-names', views.booklog_names, name='booklog-names'),
    path('tag-merges', views.tag_merges, name='tag-merges'),
    path('library', views.library_settings, name='library'),
    path('public/<str:slug>', views.public_library, name='public-library'),
]
