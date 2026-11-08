# Uhlenköper-Camp · Digitale Spielwiese

Eine responsive, statische Willkommensseite für einen einfachen Einstieg ins Vibe Coding. HTML, CSS und JavaScript ohne Build-System oder Paketabhängigkeiten.

## Lokal ansehen

Im Repository ausführen:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Die Seite ist dann lokal auf Port 8000 verfügbar. Zum Beenden Strg+C drücken.

## Mit dem Entwicklungs-Chat verändern

Zum Beispiel: „Ergänze eine Packliste zum Abhaken“ oder „Mach die Seite sommerlicher“. Der Entwicklungs-Chat bearbeitet die Dateien dieses Repositorys. Die Webseite selbst enthält keinen KI-Chat und benötigt keinen API-Schlüssel. Ihre Beispielwünsche lassen sich auswählen, bearbeiten und für den Entwicklungs-Chat kopieren.

## Zählerstände mit Fotos

Über **Zählerstände** in der Navigation lassen sich Strom-, Wasser- und Gaszähler erfassen: Zählernummer oder Standort, Ablesedatum, manuell abgelesener Wert, ein Pflichtfoto und eine optionale Notiz. Komma und Punkt sind als Dezimaltrennzeichen erlaubt; Tausendertrennzeichen nicht. Am Smartphone bietet das Fotofeld je nach Browser die Kamera an; alternativ kann eine Bilddatei ausgewählt werden. Die Vorschau hilft beim Prüfen des Fotos. Es gibt keine automatische Texterkennung.

Fotos bis 15 MB werden im Browser auf maximal 1600 Pixel Kantenlänge verkleinert und als JPEG gespeichert. Die Ablesungen einschließlich Fotos bleiben in der lokalen IndexedDB des Browsers und sind nach erneutem Laden verfügbar. Sie werden weder auf GitHub noch auf einem Server gespeichert. Es gibt keine Übertragung ans Camp, gemeinsame Datenbank oder Synchronisierung zwischen Geräten. Anderer Browser, privater Modus, eine andere Seitenadresse oder gelöschte Browserdaten können bedeuten, dass die Einträge nicht mehr verfügbar sind.

Der Verlauf zeigt die neuesten Ablesedaten zuerst. Einträge lassen sich nach Bestätigung inklusive Foto löschen. **CSV herunterladen** sichert die Werte und Notizen für Tabellenprogramme; Fotos sind nicht in der CSV enthalten und können pro Ablesung separat heruntergeladen werden. Der Export ist keine in der Anwendung wiederherstellbare Sicherung. Bei Speicherfehlern bleiben Formulareingaben erhalten. Ohne verfügbaren lokalen Speicher bleibt die Erfassung gesperrt und zeigt einen Hinweis.

## Auf GitHub Pages veröffentlichen

1. Dateien auf den Branch `main` des Repositorys übertragen.
2. Auf GitHub unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** auswählen. GitHub Pages muss für das Repository bzw. den verwendeten Tarif verfügbar sein.
3. Der Workflow `.github/workflows/pages.yml` veröffentlicht bei Änderungen auf `main`. Nach dem erstmaligen Aktivieren gegebenenfalls unter **Actions → Publish GitHub Pages → Run workflow** starten.

Die vorgesehene Projektadresse lautet `https://uhlenkoeper.github.io/spielwiese/`. Sie funktioniert erst nach erfolgreichem Deployment. Relative Dateipfade unterstützen den Projekt-Unterpfad.

## Inhalte

Die vorgestellten Funktionen sind ausdrücklich Ideen, keine zugesagten Camp-Angebote. Es werden keine Preise, Öffnungszeiten oder Veranstaltungstermine erfunden. Vor einer offiziellen geschäftlichen Nutzung müssen tatsächliche Angaben, rechtlich erforderliche Informationen und eigene Bilder ergänzt werden. Die Landschaft ist eine eigens erstellte SVG-Illustration. Schriftarten werden mit lokalen Systemschriften als Fallback dargestellt.
