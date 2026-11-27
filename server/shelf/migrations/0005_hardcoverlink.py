from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('shelf', '0004_library'),
    ]

    operations = [
        migrations.CreateModel(
            name='HardcoverLink',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('uid', models.CharField(max_length=64)),
                ('user_book_id', models.IntegerField(blank=True, null=True)),
                ('book_id', models.IntegerField(blank=True, help_text="Hardcover's book", null=True)),
                ('created', models.BooleanField(default=False, help_text='The sync added this entry on Hardcover.')),
                ('reads', models.JSONField(blank=True, default=list, help_text='Ids of the reads the sync added.')),
                ('sent', models.CharField(blank=True, help_text='A hash of what was last sent.', max_length=64)),
                ('error', models.TextField(blank=True)),
                ('checked', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='hardcover_links', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name='hardcoverlink',
            constraint=models.UniqueConstraint(fields=('user', 'uid'), name='unique_hardcover_link_per_user'),
        ),
    ]
