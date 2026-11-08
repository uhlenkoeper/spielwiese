# Uhlenköper-Camp · Digitale Spielwiese

Eine responsive Willkommensseite mit Zählererfassung. Die Oberfläche besteht aus HTML, CSS und JavaScript ohne Build-System. Für zentrale Speicherung und E-Mail-Versand gibt es zusätzlich einen Node.js-Server mit SQLite und SMTP.

## Lokal ansehen

Im Repository ausführen:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Die Seite ist dann lokal auf Port 8000 verfügbar. Zum Beenden Strg+C drücken. Bei diesem statischen Start funktionieren lokale Entwürfe; zentrale Speicherung und Versand benötigen den unten beschriebenen Server.

## Mit dem Entwicklungs-Chat verändern

Zum Beispiel: „Ergänze eine Packliste zum Abhaken“ oder „Mach die Seite sommerlicher“. Der Entwicklungs-Chat bearbeitet die Dateien dieses Repositorys. Die Webseite selbst enthält keinen KI-Chat und benötigt keinen API-Schlüssel. Ihre Beispielwünsche lassen sich auswählen, bearbeiten und für den Entwicklungs-Chat kopieren.

## Zählerstände mit Fotos

Über **Zählerstände** in der Navigation lassen sich Strom-, Wasser- und Gaszähler erfassen: Zählernummer oder Standort, Ablesedatum, manuell abgelesener Wert, ein Pflichtfoto und eine optionale Notiz. Komma und Punkt sind als Dezimaltrennzeichen erlaubt; Tausendertrennzeichen nicht. Am Smartphone bietet das Fotofeld je nach Browser die Kamera an; alternativ kann eine Bilddatei ausgewählt werden. Die Vorschau hilft beim Prüfen des Fotos. Es gibt keine automatische Texterkennung.

Fotos bis 15 MB werden im Browser auf maximal 1600 Pixel Kantenlänge verkleinert und als JPEG gespeichert. Entwürfe einschließlich Fotos bleiben zunächst in der lokalen IndexedDB des Browsers und sind nach erneutem Laden verfügbar. Anderer Browser, privater Modus, eine andere Seitenadresse oder gelöschte Browserdaten können diese noch nicht abgeschlossenen Entwürfe unzugänglich machen.

Der Verlauf zeigt die neuesten Ablesedaten zuerst. **Alle Ablesungen abschließen und senden** übermittelt alle noch nicht versendeten Ablesungen als eine Erfassung. Erst dieser bewusste Abschluss löst automatisch den gemeinsamen Versand an **info@uhlenkoeper-camp.de** aus. Die Empfängeradresse ist serverseitig festgelegt und kann nicht durch Formularfelder überschrieben werden. Die E-Mail enthält alle Werte und Notizen als Text, eine CSV-Übersicht und die Fotos als JPEG-Anhänge. Eine Erfassung umfasst höchstens 50 Ablesungen und insgesamt 8 MB an verkleinerten Fotos.

Vor dem SMTP-Versand speichert der Server Werte und Fotos zusammen in einer SQLite-Transaktion. Bei fehlgeschlagenem Versand gehen sie nicht verloren. Eine lokal gespeicherte Erfassungsnummer bleibt auch beim Neuladen erhalten. Wiederholte Abschlussanfragen mit derselben Nummer senden nach bestätigter Annahme keine zweite Mail. Während eines Versands gibt der Server nur den laufenden Status zurück. Bei einem unklaren SMTP-Ergebnis (z. B. Verbindungsabbruch nach Übergabe) oder einem Serverneustart während des Versands wird kein automatischer zweiter Versand ausgelöst: zuerst das Camp-Postfach anhand der Erfassungsnummer prüfen. Die Bestätigung bedeutet Annahme durch den Mailanbieter, nicht nachgewiesene Zustellung ins Postfach.

Für das Abschließen und Versenden ist **kein Camp-Zugangscode erforderlich**. Der Browser erstellt automatisch eine zufällige Empfangsbestätigung pro Erfassung und behält diese für wiederholte Übermittlungen bei. Der Server speichert nur ihren Hash. **Meine zentral gespeicherten Erfassungen laden** zeigt ausschließlich Erfassungen, deren Empfangsbestätigung in diesem Browser hinterlegt ist, einschließlich Versandstatus und Foto-Download. Die Bestätigung wird automatisch im Hintergrund verwendet; es gibt kein Codefeld. Ohne passende Bestätigung sind einzelne Erfassungen und Fotos nicht öffentlich abrufbar. Nach dem Löschen der Browserdaten ist dieser persönliche Abruf nicht mehr möglich; die zentralen Kopien und E-Mails bleiben erhalten. Einträge einer begonnenen Übermittlung sind bis zur Versandbestätigung lokal nicht löschbar. Das Löschen einer lokalen Kopie löscht keine zentralen Daten oder bereits versendeten E-Mails.

**CSV herunterladen** sichert lokale Werte und Notizen für Tabellenprogramme; Fotos sind in dieser CSV nicht enthalten und lassen sich einzeln herunterladen. Dieser Export ist keine in der Anwendung wiederherstellbare Sicherung. Bei Speicherfehlern bleiben Formulareingaben erhalten. Ohne verfügbaren lokalen Speicher bleibt die Erfassung gesperrt und zeigt einen Hinweis.

## Zentralen Speicher und automatischen Versand einrichten

**Aktivierungsstand:** Der Servercode ist vorbereitet. Für den produktiven Betrieb werden ein laufender Node.js-Server mit persistentem Datenträger sowie die SMTP-Konfiguration des Camp-Mailanbieters benötigt. GitHub Pages kann diesen Server nicht ausführen. Bis der Dienst erreichbar und der Versand konfiguriert ist, bleibt der Abschlussknopf deaktiviert. Zugangsdaten gehören ausschließlich in die Serverkonfiguration, niemals in GitHub-Dateien, HTML, JavaScript oder Chatnachrichten.

1. Auf einem Server mit **Node.js 24 oder neuer** das Repository auschecken und `npm ci --omit=dev` ausführen.
2. `.env.example` als `.env` kopieren. `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` und ein beim Mailanbieter freigegebenes `SMTP_FROM` befüllen. SMTP nutzt Port 587 mit verpflichtendem STARTTLS oder Port 465 mit `SMTP_SECURE=true`; Zertifikatsprüfung bleibt aktiviert. Ein Camp-Zugangscode ist weder zum Serverstart noch zum Erfassen oder Versenden notwendig.
3. `DATA_DIR` auf ein **dauerhaftes, nicht öffentlich ausgeliefertes Verzeichnis** setzen. Es enthält `readings.sqlite` samt SQLite-WAL-Dateien und damit auch sämtliche Fotos. Der Datenträger darf bei Deployments oder Neustarts nicht ersetzt werden. Backups regelmäßig mit dem SQLite-Backup-Verfahren oder bei gestopptem Server erstellen und Wiederherstellung prüfen. Aufbewahrung und Löschung zentraler Erfassungen müssen im Betrieb festgelegt werden; es gibt noch keine Verwaltungsoberfläche zum zentralen Löschen.
4. `npm start` als dauerhaft überwachten Dienst starten. Standardmäßig bindet der Dienst an `127.0.0.1:8000`. Er liefert sowohl die bestehende Seite als auch `/api/…` aus. Einen HTTPS-Reverseproxy vorschalten; für diesen öffentlichen Ursprung `ALLOWED_ORIGIN` setzen. Bei Containerbetrieb zusätzlich `HOST=0.0.0.0` und ein persistentes Volume für `DATA_DIR` verwenden. Nur eine Serverinstanz pro Datenbank betreiben.
5. **Variante A:** Die gesamte Seite über diesen HTTPS-Server bereitstellen; `<meta name="meter-api" content="">` in `index.html` bleibt leer. **Variante B:** Die Oberfläche auf GitHub Pages belassen und im Meta-Feld `meter-api` die HTTPS-Adresse des Backends eintragen (ohne abschließenden Schrägstrich). Auf dem Server dann `ALLOWED_ORIGIN=https://uhlenkoeper.github.io` setzen. Es werden nur exakte konfigurierte Ursprünge freigegeben; keine pauschale CORS-Freigabe.
6. Erst nach Konfiguration mit einer echten Testablesung prüfen: Abschluss ohne Codeeingabe, Abruf der eigenen gespeicherten Erfassung und Fotos, E-Mail im Camp-Postfach samt Anhängen, erneuter Abschluss ohne zweite Mail sowie Abruf nach Serverneustart. Neue öffentliche Erfassungen sind auf 30 pro Stunde und Quell-IP begrenzt; Wiederholungen bestehender Erfassungen mit passender Empfangsbestätigung zählen nicht erneut. Hinter einem Reverseproxy teilen sich Anfragen möglicherweise dieselbe Quell-IP; das Limit muss beim produktiven Betrieb zur tatsächlichen Netzkonfiguration passen.

Optional kann ausschließlich für administrative API-Zugriffe `METER_ADMIN_CODE` mit mindestens 20 zufälligen Zeichen gesetzt werden. Dieser Schlüssel ermöglicht die Gesamtübersicht unter `GET /api/submissions` und Fotoabrufe per `Authorization: Bearer …`; er gehört nicht ins Formular oder den Browsercode. Ohne Verwaltungsschlüssel bleibt die Gesamtübersicht gesperrt, während Erfassen, Versenden und eigene Empfangsbestätigungen funktionieren. Bestehendes `METER_ACCESS_CODE` wird als veralteter Name für denselben optionalen Verwaltungsschlüssel weiterhin unterstützt.

`npm test` prüft serverseitig Speicherung vor dem Versand ohne Camp-Code, MIME-Anhänge, private Empfangsbestätigungen und Verwaltungszugriffe, Ursprungskontrolle, Validierung, Zugriff auf Fotos, Mengenbegrenzung, wiederholte/parallele Abschlüsse und Mailfehler. Diese Tests verwenden einen lokalen Mail-Testtransport und versenden keine echten E-Mails. Kamera, echte SMTP-Zugangsdaten und produktives Hosting sind dadurch nicht geprüft.

## Auf GitHub Pages veröffentlichen

1. Dateien auf den Branch `main` des Repositorys übertragen.
2. Auf GitHub unter **Settings → Pages → Build and deployment → Source** die Option **GitHub Actions** auswählen. GitHub Pages muss für das Repository bzw. den verwendeten Tarif verfügbar sein.
3. Der Workflow `.github/workflows/pages.yml` veröffentlicht bei Änderungen auf `main`. Nach dem erstmaligen Aktivieren gegebenenfalls unter **Actions → Publish GitHub Pages → Run workflow** starten.

Die vorgesehene Projektadresse lautet `https://uhlenkoeper.github.io/spielwiese/`. Sie funktioniert erst nach erfolgreichem Deployment. Relative Dateipfade unterstützen den Projekt-Unterpfad.

## Inhalte

Die vorgestellten Funktionen sind ausdrücklich Ideen, keine zugesagten Camp-Angebote. Es werden keine Preise, Öffnungszeiten oder Veranstaltungstermine erfunden. Vor einer offiziellen geschäftlichen Nutzung müssen tatsächliche Angaben, rechtlich erforderliche Informationen und eigene Bilder ergänzt werden. Die Landschaft ist eine eigens erstellte SVG-Illustration. Schriftarten werden mit lokalen Systemschriften als Fallback dargestellt.
