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

## Auf GitHub Pages veröffentlichen

1. Dateien auf den Branch `main` des Repositorys übertragen.
2. Auf GitHub unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** auswählen. GitHub Pages muss für das Repository bzw. den verwendeten Tarif verfügbar sein.
3. Der Workflow `.github/workflows/pages.yml` veröffentlicht bei Änderungen auf `main`. Nach dem erstmaligen Aktivieren gegebenenfalls unter **Actions → Publish GitHub Pages → Run workflow** starten.

Die vorgesehene Projektadresse lautet `https://uhlenkoeper.github.io/spielwiese/`. Sie funktioniert erst nach erfolgreichem Deployment. Relative Dateipfade unterstützen den Projekt-Unterpfad.

## Inhalte

Die vorgestellten Funktionen sind ausdrücklich Ideen, keine zugesagten Camp-Angebote. Es werden keine Preise, Öffnungszeiten oder Veranstaltungstermine erfunden. Vor einer offiziellen geschäftlichen Nutzung müssen tatsächliche Angaben, rechtlich erforderliche Informationen und eigene Bilder ergänzt werden. Die Landschaft ist eine eigens erstellte SVG-Illustration. Schriftarten werden mit lokalen Systemschriften als Fallback dargestellt.
