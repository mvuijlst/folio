from django.contrib import admin

from .models import Book, List, Term


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ['title', 'author', 'isbn', 'on_lists', 'user', 'deleted', 'changed']
    list_filter = ['user', 'deleted']
    search_fields = ['title', 'uid']
    readonly_fields = ['user', 'uid', 'title', 'deleted', 'modified', 'changed', 'data']

    @admin.display(description='Author')
    def author(self, obj):
        return obj.data.get('author', '')

    @admin.display(description='ISBN')
    def isbn(self, obj):
        return obj.data.get('isbn', '')

    @admin.display(description='Lists')
    def on_lists(self, obj):
        on = obj.data.get('lists')
        if not isinstance(on, dict):
            return 'library' if on is None else ''   # books from before lists existed
        return ', '.join(on)

    def has_add_permission(self, request):
        return False


@admin.register(List)
class ListAdmin(admin.ModelAdmin):
    list_display = ['name', 'group', 'user', 'deleted', 'changed']
    list_filter = ['user', 'deleted']
    search_fields = ['name', 'uid']
    readonly_fields = ['user', 'uid', 'name', 'deleted', 'modified', 'changed', 'data']

    @admin.display(description='Either-or set')
    def group(self, obj):
        return obj.data.get('group', '')

    def has_add_permission(self, request):
        return False


@admin.register(Term)
class TermAdmin(admin.ModelAdmin):
    list_display = ['value', 'kind', 'english', 'user', 'deleted', 'changed']
    list_filter = ['user', 'deleted']
    search_fields = ['value', 'uid']
    readonly_fields = ['user', 'uid', 'value', 'deleted', 'modified', 'changed', 'data']

    @admin.display(description='Kind')
    def kind(self, obj):
        return obj.data.get('kind', '')

    @admin.display(description='English')
    def english(self, obj):
        return obj.data.get('en', '')

    def has_add_permission(self, request):
        return False
