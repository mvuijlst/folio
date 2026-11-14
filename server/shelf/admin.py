from django.contrib import admin

from .models import Book


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ['title', 'author', 'isbn', 'user', 'deleted', 'changed']
    list_filter = ['user', 'deleted']
    search_fields = ['title', 'uid']
    readonly_fields = ['user', 'uid', 'title', 'deleted', 'modified', 'changed', 'data']

    @admin.display(description='Author')
    def author(self, obj):
        return obj.data.get('author', '')

    @admin.display(description='ISBN')
    def isbn(self, obj):
        return obj.data.get('isbn', '')

    def has_add_permission(self, request):
        return False
