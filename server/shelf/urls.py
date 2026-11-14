from django.urls import path

from . import views

urlpatterns = [
    path('session', views.session, name='session'),
    path('login', views.login_view, name='login'),
    path('logout', views.logout_view, name='logout'),
    path('sync', views.sync, name='sync'),
    path('cover', views.cover, name='cover'),
]
