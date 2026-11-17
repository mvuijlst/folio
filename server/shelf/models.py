from django.conf import settings
from django.db import models


class Record(models.Model):
    """Something one user keeps in the app and syncs between devices, stored as the app sends it.

    `uid` is the id the device gave it. `modified` is when a device last changed it (the
    newer change wins); `changed` is when the server stored it, which is what other devices
    ask "what's new since …" against. Deleted records stay as tombstones so the deletion
    reaches every device.
    """
    KEY = ''     # what the record is called in a sync change: {"id", "modified", "deleted", KEY: data}
    LABEL = ''   # the field of `data` that is copied to a column of the same name, for the admin

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='%(class)ss')
    uid = models.CharField(max_length=64)
    data = models.JSONField(default=dict, blank=True)
    deleted = models.BooleanField(default=False)
    modified = models.DateTimeField()
    changed = models.DateTimeField(db_index=True)

    class Meta:
        abstract = True
        ordering = ['-changed']
        constraints = [models.UniqueConstraint(fields=['user', 'uid'], name='unique_%(class)s_per_user')]

    def as_change(self):
        return {
            'id': self.uid,
            'modified': self.modified.isoformat().replace('+00:00', 'Z'),
            'deleted': self.deleted,
            self.KEY: None if self.deleted else self.data,
        }


class Book(Record):
    """One book on one user's shelf. The lists it is on are part of `data` ("lists")."""
    KEY = 'book'
    LABEL = 'title'

    title = models.CharField(max_length=300, blank=True)

    def __str__(self):
        return self.title or self.data.get('isbn') or self.uid


class List(Record):
    """One of a user's lists of books (to read, library, lent out, …).

    Lists that share a "group" in `data` are either-or: the app keeps a book on at most one
    of them.
    """
    KEY = 'list'
    LABEL = 'name'

    name = models.CharField(max_length=300, blank=True)

    def __str__(self):
        return self.name or self.uid


class Term(Record):
    """A word the user keeps in two languages: for now a role of people on a book (terms.js).

    `data` is {"kind", "nl", "en", "aliases", "gone"}; `value` is the word stored on books.
    """
    KEY = 'term'
    LABEL = 'value'

    value = models.CharField(max_length=300, blank=True)

    def __str__(self):
        return self.value or self.uid
