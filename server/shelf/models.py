from django.conf import settings
from django.db import models


class Book(models.Model):
    """One book on one user's shelf, as the app stores it.

    `uid` is the id the phone gave the book. `modified` is when a device last changed it
    (the newer change wins); `changed` is when the server stored it, which is what other
    devices ask "what's new since …" against. Deleted books stay as tombstones so the
    deletion reaches every device.
    """
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='books')
    uid = models.CharField(max_length=64)
    data = models.JSONField(default=dict, blank=True)
    title = models.CharField(max_length=300, blank=True)
    deleted = models.BooleanField(default=False)
    modified = models.DateTimeField()
    changed = models.DateTimeField(db_index=True)

    class Meta:
        ordering = ['-changed']
        constraints = [models.UniqueConstraint(fields=['user', 'uid'], name='unique_book_per_user')]

    def __str__(self):
        return self.title or self.data.get('isbn') or self.uid

    def as_change(self):
        return {
            'id': self.uid,
            'modified': self.modified.isoformat().replace('+00:00', 'Z'),
            'deleted': self.deleted,
            'book': None if self.deleted else self.data,
        }
