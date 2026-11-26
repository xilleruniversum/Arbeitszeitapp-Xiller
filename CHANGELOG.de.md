# Änderungsverlauf

## 1.4.7

### Neu

- **HR-Statistik mit Ist- und Sollstunden.** Ein Balkendiagramm und eine aufklappbare Tabelle zeigen den Stundenverlauf für den gewählten Zeitraum. Standardmäßig ist „Eigener Zeitraum“ vom Monatsanfang bis heute vorbelegt. „Dieser Monat“, „Dieses Jahr“ und „Vergangenes Jahr“ stehen ebenfalls zur Auswahl. Die Statistik übernimmt Statusfilter und Namenssuche der Mitarbeitendenliste. Die aktuellen Stundensalden bleiben separat abrufbar.
- **E-Mail-Texte je Kontosprache.** Erinnerungsmails und Texte für die eigene wöchentliche Übersicht lassen sich pro Sprache bearbeiten und auf den jeweiligen Originaltext zurücksetzen. Beim Versand gilt die Nextcloud-Kontosprache des Empfängers.

### Verbessert

- Die HR-Übersicht zeigt beim Öffnen und nach dem Zurücksetzen der Filter standardmäßig aktive Mitarbeitende.
- Die Versionshistorie öffnet sich in der aktuellen App-Ansicht ohne Neuladen. Die drei neuesten Versionen stehen direkt zur Auswahl. Frühere Einträge lassen sich unter „Ältere Versionen“ aufklappen.
- Beim Speichern von HR-Gruppenregeln erscheint nun ein deutlicher Hinweis in der unteren Mitte des Bildschirms.

### Fehlerbehebung

- Die HR-Mitarbeitendenliste lädt unter PostgreSQL auch bei aktivierter Wochenend- und Feiertagsregel.

## 1.4.6

### Neu

- Administrierende können je HR-Regel bestehende Nextcloud-Gruppen für aktive und inaktive Mitarbeitende auswählen.
- Die HR-Übersicht und der Änderungsverlauf stufen Mitarbeitende mit beiden Mitgliedschaften als aktiv ein. Unter „Alle“ erscheint jedes Konto einmal.
- Bestehende HR-Regeln behalten ihr bisheriges Statusverhalten, bis ihre Mitarbeitergruppenauswahl geändert wird.

### Geändert

- Update-Hinweise erscheinen in der Nextcloud-Glocke. „Änderungen ansehen“ öffnet die Versionshistorie mit aufklappbaren Einträgen.
- Die Einladung zum Tourguide lässt sich dauerhaft ausblenden. Die Tour kann jederzeit manuell gestartet werden.
- Die Tabelle im Änderungsverlauf bietet mehr Platz für die Namen der Bearbeiter. Die HR-Hilfe erklärt, wo die Pausenregeln eingestellt werden.
