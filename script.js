const idea = document.querySelector('#idea');
const status = document.querySelector('#copy-status');
document.querySelectorAll('[data-idea]').forEach(button => {
  button.addEventListener('click', () => {
    idea.value = button.dataset.idea;
    document.querySelectorAll('.idea-chips button').forEach(chip => chip.setAttribute('aria-pressed', String(chip === button)));
    status.textContent = 'Dein Wunsch ist bereit. Kopiere ihn in den Entwicklungs-Chat.';
    document.querySelector('#ausprobieren').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    idea.focus({ preventScroll: true });
  });
});
document.querySelector('#copy').addEventListener('click', async () => {
  if (!idea.value.trim()) {
    status.textContent = 'Schreibe zuerst einen Wunsch oder wähle eine Anregung.';
    idea.focus();
    return;
  }
  try {
    await navigator.clipboard.writeText(idea.value);
    status.textContent = 'Kopiert! Jetzt hier im Entwicklungs-Chat einfügen.';
  } catch {
    idea.focus();
    idea.select();
    status.textContent = 'Bitte den markierten Text mit Strg+C oder ⌘C kopieren.';
  }
});

// Photos and readings stay in this browser's IndexedDB, never in the repository.
(() => {
  const form = document.querySelector('#meter-form');
  const fields = document.querySelector('#meter-fields');
  const message = document.querySelector('#meter-status');
  const type = document.querySelector('#meter-type');
  const name = document.querySelector('#meter-name');
  const date = document.querySelector('#meter-date');
  const value = document.querySelector('#meter-value');
  const photo = document.querySelector('#meter-photo');
  const preview = document.querySelector('#meter-preview');
  const note = document.querySelector('#meter-note');
  const list = document.querySelector('#meter-list');
  const exportButton = document.querySelector('#meter-export');
  const types = { strom: ['Strom', 'kWh'], wasser: ['Wasser', 'm³'], gas: ['Gas', 'm³'] };
  let db;
  let records = [];
  let preparedPhoto = null;
  let photoVersion = 0;
  let previewUrl;
  let historyUrls = [];

  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  date.value = localToday();
  date.max = localToday();
  function tell(text, error = false) {
    message.textContent = text;
    message.dataset.error = String(error);
  }

  function transaction(mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('readings', mode);
      const request = action(tx.objectStore('readings'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || new Error('Speicherfehler'));
      tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen'));
    });
  }

  function resetPhoto() {
    preparedPhoto = null;
    photoVersion++;
    photo.setCustomValidity('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.removeAttribute('src');
    preview.hidden = true;
  }

  // Decode first: the MIME type alone cannot establish that a file is an image.
  async function compressPhoto(file) {
    if (!file.type.startsWith('image/')) throw new Error('Bitte eine Bilddatei auswählen.');
    if (file.size > 15 * 1024 * 1024) throw new Error('Das Foto ist zu groß. Bitte ein Bild mit höchstens 15 MB auswählen.');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('Dieses Bild kann nicht gelesen werden. Bitte als JPEG, PNG oder WebP auswählen.'));
        image.src = url;
      });
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Das Foto kann in diesem Browser nicht verarbeitet werden.');
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Das Foto konnte nicht verarbeitet werden. Bitte ein anderes auswählen.'));
      }, 'image/jpeg', 0.88));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  photo.addEventListener('change', async () => {
    resetPhoto();
    const file = photo.files[0];
    if (!file) return;
    const version = photoVersion;
    photo.setCustomValidity('Bitte warten, bis das Foto verarbeitet wurde.');
    tell('Foto wird vorbereitet …');
    try {
      const blob = await compressPhoto(file);
      if (version !== photoVersion) return;
      preparedPhoto = blob;
      photo.setCustomValidity('');
      previewUrl = URL.createObjectURL(blob);
      preview.src = previewUrl;
      preview.hidden = false;
      tell('Foto bereit. Prüfe den abgelesenen Wert und speichere die Ablesung.');
    } catch (error) {
      if (version !== photoVersion) return;
      photo.setCustomValidity(error.message);
      tell(error.message, true);
    }
  });

  type.addEventListener('change', () => {
    document.querySelector('#meter-unit').textContent = `(${types[type.value][1]})`;
  });
  value.addEventListener('input', () => value.setCustomValidity(''));
  name.addEventListener('input', () => name.setCustomValidity(''));

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    // Leave time for the browser to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    historyUrls.forEach(url => URL.revokeObjectURL(url));
    historyUrls = [];
    list.replaceChildren();
    document.querySelector('#meter-empty').hidden = records.length > 0;
    exportButton.disabled = records.length === 0;
    for (const record of records) {
      const item = element('li', 'meter-entry');
      const [label, unit] = types[record.type];
      item.append(element('h4', '', record.meter));
      item.append(element('p', '', `${label} · ${new Date(`${record.date}T12:00:00`).toLocaleDateString('de-DE')}`));
      item.append(element('p', 'meter-reading', `${record.value.toLocaleString('de-DE', { maximumFractionDigits: 6 })} ${unit}`));
      if (record.note) item.append(element('p', '', record.note));
      const image = element('img', 'meter-entry-photo');
      image.alt = `Zählerfoto für ${record.meter} vom ${record.date}`;
      image.loading = 'lazy';
      image.src = URL.createObjectURL(record.photo);
      historyUrls.push(image.src);
      item.append(image);
      const actions = element('div', 'meter-actions');
      const photoLink = element('a', 'meter-text-button', 'Foto herunterladen ↓');
      photoLink.href = image.src;
      photoLink.download = `zaehler-${record.date}-${record.id}.jpg`;
      const remove = element('button', 'meter-text-button meter-delete', 'Löschen');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Ablesung für ${record.meter} vom ${record.date} löschen`);
      remove.addEventListener('click', async () => {
        if (!confirm(`Ablesung für „${record.meter}“ vom ${record.date} inklusive Foto auf diesem Gerät löschen?`)) return;
        remove.disabled = true;
        try {
          await transaction('readwrite', store => store.delete(record.id));
          records = records.filter(entry => entry.id !== record.id);
          render();
          tell('Ablesung und Foto wurden gelöscht.');
          exportButton.disabled ? name.focus() : exportButton.focus();
        } catch {
          remove.disabled = false;
          tell('Die Ablesung konnte nicht gelöscht werden. Bitte erneut versuchen.', true);
        }
      });
      actions.append(photoLink, remove);
      item.append(actions);
      list.append(item);
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (fields.disabled) return;
    name.setCustomValidity(name.value.trim() ? '' : 'Bitte eine Zählernummer oder einen Standort eingeben.');
    const text = value.value.trim();
    const reading = Number(text.replace(',', '.'));
    value.setCustomValidity(/^\d+([.,]\d{1,6})?$/.test(text) && reading <= Number.MAX_SAFE_INTEGER
      ? '' : 'Bitte einen positiven Zählerstand oder 0 mit höchstens 6 Nachkommastellen eingeben, ohne Tausendertrennzeichen.');
    date.max = localToday();
    if (!form.reportValidity()) return;
    if (!preparedPhoto) {
      tell('Bitte zuerst ein lesbares Zählerfoto auswählen.', true);
      photo.focus();
      return;
    }
    const record = {
      type: type.value, meter: name.value.trim(), date: date.value,
      value: reading, note: note.value.trim(), photo: preparedPhoto,
      createdAt: Date.now()
    };
    fields.disabled = true;
    tell('Ablesung wird gespeichert …');
    try {
      record.id = await transaction('readwrite', store => store.add(record));
      records.push(record);
      records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
      render();
      // Keep the selected meter and date for subsequent readings.
      value.value = '';
      photo.value = '';
      note.value = '';
      resetPhoto();
      tell('Ablesung mit Foto auf diesem Gerät gespeichert.');
    } catch (error) {
      tell(error.name === 'QuotaExceededError'
        ? 'Der Browserspeicher ist voll. Sichere ältere Ablesungen und Fotos und lösche sie anschließend. Deine Eingaben bleiben erhalten.'
        : 'Speichern fehlgeschlagen. Bitte Browserspeicher zulassen und erneut versuchen. Deine Eingaben bleiben erhalten.', true);
    } finally {
      fields.disabled = false;
    }
  });

  exportButton.addEventListener('click', () => {
    // Neutralize spreadsheet formulas in free text before quoting CSV cells.
    const cell = input => `"${String(input).replace(/^[\s]*[=+@-]/, match => `'${match}`).replaceAll('"', '""')}"`;
    const rows = [['Zählerart', 'Zählernummer / Standort', 'Ablesedatum', 'Zählerstand', 'Einheit', 'Notiz']];
    records.forEach(record => rows.push([
      types[record.type][0], record.meter, record.date,
      String(record.value).replace('.', ','), types[record.type][1], record.note
    ]));
    download(new Blob(['\uFEFF', rows.map(row => row.map(cell).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `zaehlerstaende-${localToday()}.csv`);
    tell('CSV heruntergeladen. Fotos bitte bei der jeweiligen Ablesung separat herunterladen.');
  });

  try {
    const open = indexedDB.open('uhlenkoeper-meter-readings', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
    };
    open.onerror = () => tell('Der lokale Speicher ist nicht verfügbar. Bitte Browserspeicher zulassen und die Seite neu laden.', true);
    open.onblocked = () => tell('Bitte andere Tabs dieser Seite schließen und neu laden, um den lokalen Speicher zu öffnen.', true);
    open.onsuccess = async () => {
      db = open.result;
      db.onversionchange = () => {
        db.close();
        fields.disabled = true;
        tell('Der lokale Speicher wurde in einem anderen Tab geändert. Bitte die Seite neu laden.', true);
      };
      try {
        records = await transaction('readonly', store => store.getAll());
        records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
        render();
        fields.disabled = false;
        tell('Bereit für deine nächste Ablesung.');
      } catch {
        tell('Gespeicherte Ablesungen konnten nicht geladen werden. Bitte die Seite neu laden.', true);
      }
    };
  } catch {
    tell('Dieser Browser stellt keinen lokalen Speicher bereit. Bitte einen Browser mit IndexedDB verwenden.', true);
  }
})();
