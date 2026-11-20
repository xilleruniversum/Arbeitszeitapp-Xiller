# Nextcloud Timesheet (XiLLeR GmbH)

<details open>
<summary>Deutsch</summary>

## Was macht die App?

Mit Timesheet erfassen Mitarbeitende ihre Arbeitszeiten direkt in Nextcloud. Sie tragen Arbeitsbeginn, Arbeitsende und Pausen ein. Die App berechnet daraus die Arbeitszeit und zeigt den Stundenstand an.

Die Personalabteilung (HR) erhält eine Übersicht über Mitarbeitende und ihre erfassten Zeiten. Arbeitszeitnachweise lassen sich als Exceldatei herunterladen und weiterverarbeiten.

Dieses Projekt basiert auf Timesheet 1.2.0 von XiLLeR und wird von der XiLLeR GmbH geführt.

## Funktionen

### Für Mitarbeitende

- Pro Tag einen Eintrag mit Beginn, Ende, gesamter Pausendauer und Kommentar anlegen, ändern oder löschen.
- Unvollständige Einträge und reine Kommentare speichern, um Angaben später zu ergänzen.
- Erfasste Arbeitszeit, Tagesdifferenz und Stundenstände in der Monatsübersicht ansehen.
- Arbeitszeitnachweise für einen Monat oder ein Jahr als Exceldatei (XLSX) exportieren.
- Hinweise sehen, etwa bei zu kurzen Pausen oder zu langen Arbeitstagen.

So können Mitarbeitende ihre Einträge selbst pflegen und nachvollziehen, wie ihre erfassten Zeiten berechnet werden.

### Für HR

- Eine Übersicht mit Stundenständen, letzten vollständigen Einträgen und Warnhinweisen öffnen.
- Einträge von Mitarbeitenden ansehen, bearbeiten und exportieren.
- Tagesziele und die Feiertagsregion pro Person einstellen.
- Optionale E-Mail-Hinweise zu fehlenden Einträgen und überschrittenen Saldo-Schwellen erhalten.

Die Übersicht hilft HR, auffällige Einträge zu finden und die erfassten Zeiten gesammelt durchzugehen. Der Excelexport liefert Dateien für die weitere Bearbeitung; eine direkte Anbindung an eine Lohnsoftware ist nicht enthalten.

### Einstellungen und Grenzen

Nextcloud-Admins verwalten die Zuordnung von HR-Gruppen und HR-Konten zu Mitarbeitendengruppen unter **Profil → Einstellungen → Administration → Arbeitszeitnachweis**. HR legt Zeitregeln und deren Prioritäten unter **Profil → Einstellungen → Arbeitszeitnachweis** fest. Zu den persönlichen Einstellungen gehören Tagesziel, Feiertagsregion und HR-Benachrichtigungen.

Die App verwendet ein einheitliches Tagesziel pro Person. Für die Sollzeitberechnung zählen nur vollständige Zeiteinträge: Leere Tage und reine Kommentare erzeugen nicht automatisch Minusstunden. Pausen werden als Gesamtdauer pro Tag erfasst.

Feiertage werden für deutsche Bundesländer unterstützt. E-Mail-Hinweise gehen derzeit an HR und benötigen eingerichteten Nextcloud-Mailversand sowie laufende Hintergrundaufgaben. Die Zeitregeln zeigen Hinweise an; ein Ablauf für verbindliche HR-Freigaben ist nicht enthalten.

## Voraussetzungen

Für Version 1.4.5 ist in den [App-Metadaten](appinfo/info.xml) folgende Kompatibilität vorgesehen:

- Nextcloud 30–34
- PHP 8.2–8.5

Das sind die deklarierten Versionsgrenzen. Sie sind kein Nachweis, dass jede Kombination praktisch getestet wurde. Timesheet läuft innerhalb einer eingerichteten Nextcloud-Installation.

Für Feiertagsdaten benötigt Nextcloud ausgehenden HTTPS-Zugriff auf `get.api-feiertage.de`, sofern keine gültigen zwischengespeicherten Daten vorhanden sind.

## Admin-Checkliste für aktive und archivierte Mitarbeitende

Die HR-Übersicht und der Änderungsverlauf zeigen Mitarbeitende, die mindestens einer der beiden Statusgruppen angehören **und** eine passende HR-Zuordnung haben. Beim Wechsel des Status bleiben die Zeiteinträge erhalten.

1. **Aktive Mitarbeitende prüfen.** Konten in der Nextcloud-Gruppe mit der exakten Kennung `Zeitnachweis` erscheinen unter **Aktiv** und **Alle** jeweils einmal, auch bei gleichzeitiger Mitgliedschaft in `Zeitnachweis-Archiv`. Bestehende Abteilungsgruppen und HR-Zuordnungen beibehalten.
2. **Archivgruppe bei Bedarf anlegen.** Neue Mitarbeitende können bei der Einrichtung beiden Gruppen zugewiesen werden. Zum Archivieren genügt dann das Entfernen aus `Zeitnachweis`. Das Konto bleibt in `Zeitnachweis-Archiv` und erscheint bei passender HR-Zuordnung unter **Inaktiv** und **Alle**.
3. **HR-Zugriff kontrollieren.** Unter **Profil → Einstellungen → Administration → Arbeitszeitnachweis** prüfen, ob archivierte Konten weiterhin über eine passende Mitarbeitendengruppe dem zuständigen HR-Konto zugeordnet sind. Die gemeinsame Archivgruppe nur einer HR-Regel hinzufügen, wenn die zuständigen HR-Konten alle Mitglieder dieser Gruppe sehen dürfen. Bei Doppelmitgliedschaft gehören dazu auch aktive Konten.
4. **Filter testen.** Mit einem zuständigen HR-Konto in der HR-Übersicht und im Änderungsverlauf die Filter **Alle**, **Aktiv** und **Inaktiv** prüfen.

## Installation und Weiterentwicklung

Die [technische Anleitung](docs/TECHNICAL_GUIDE.md) erklärt den Aufbau, die Werkzeuge und das Ausprobieren eigener Änderungen in einer lokalen Demo. Dort stehen auch die noch offenen Fragen zu Installation, Tests und Veröffentlichung.

## Lizenz

Die App steht unter **AGPL-3.0-or-later**. Der vollständige Lizenztext steht in [LICENSE](LICENSE).

</details>

<details>
<summary>English</summary>

## What does the app do?

Timesheet lets employees record their working hours directly in Nextcloud. They enter their start time, end time and breaks. The app calculates working time and displays their balance.

Human Resources (HR) gets an overview of employees and their recorded hours. Timesheets can be downloaded as Excel files for further processing.

This project builds on Timesheet 1.2.0 by XiLLeR and is being continued by XiLLeR GmbH.

## Features

### For employees

- Create, edit or delete one entry per day with a start time, end time, total break duration and comment.
- Save incomplete entries or comments on their own and add missing details later.
- View recorded working time, daily differences and balances in the monthly overview.
- Export timesheets for a month or a year as Excel files (XLSX).
- See warnings, for example about short breaks or long working days.

Employees can maintain their own entries and see how their recorded hours are calculated.

### For HR

- Open an overview of balances, last complete entries and warnings.
- View, edit and export employee entries.
- Set each person's daily target and public holiday region.
- Receive optional email notifications about missing entries and exceeded balance thresholds.

The overview helps HR find entries that need attention and review recorded hours together. Excel exports provide files for further processing; there is no direct integration with payroll software.

### Settings and limitations

Nextcloud administrators manage the assignment of HR groups and HR accounts to employee groups under **Profile → Settings → Administration → Timesheet**. HR configures time rules and their priorities under **Profile → Settings → Timesheet**. Personal settings include the daily target, public holiday region and HR notifications.

The app uses a uniform daily target for each person. Only complete time entries count towards target hours: empty days and comments on their own do not automatically create negative hours. Breaks are recorded as a total duration per day.

Public holidays are supported for German federal states. Email notifications currently go to HR and require configured Nextcloud mail delivery and running background jobs. Time rules display warnings; a binding HR approval workflow is not included.

## Requirements

The [app metadata](appinfo/info.xml) declares the following compatibility for version 1.4.5:

- Nextcloud 30–34
- PHP 8.2–8.5

These are declared version limits, not evidence that every combination has been tested. Timesheet runs inside a configured Nextcloud installation.

For public holiday data, Nextcloud needs outbound HTTPS access to `get.api-feiertage.de` unless valid cached data is available.

## Administrator checklist for active and archived employees

The HR overview and change history show employees who belong to at least one of the two status groups **and** are covered by an HR assignment. Changing status preserves existing time entries.

1. **Check active employees.** Accounts in the Nextcloud group with the exact ID `Zeitnachweis` appear once under **Active** and once under **All**, even if they also belong to `Zeitnachweis-Archiv`. Keep existing department groups and HR assignments.
2. **Create the archive group if needed.** You can assign new employees to both groups when you create their accounts. To archive one of these accounts, remove it from `Zeitnachweis`. It stays in `Zeitnachweis-Archiv` and appears under **Inactive** and **All** if it is covered by an HR assignment.
3. **Check HR access.** Under **Profile → Settings → Administration → Timesheet**, check that archived accounts remain assigned to the responsible HR account through an appropriate employee group. Add the shared archive group to an HR rule only if the responsible HR accounts are allowed to see all members of that group. That includes active accounts assigned to both status groups.
4. **Test the filters.** Using a responsible HR account, check the **All**, **Active** and **Inactive** filters in the HR overview and change history.

## Installation and development

The [technical guide](docs/TECHNICAL_GUIDE.md) explains the project structure, tools and how changes can be tested in a local demo. It also lists unresolved questions about installation, testing and publishing.

## License

The app is licensed under **AGPL-3.0-or-later**. See [LICENSE](LICENSE) for the full license text.

</details>
