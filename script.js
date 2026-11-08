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

// Local drafts are uploaded as one immutable collection only on explicit completion.
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
  const finishButton = document.querySelector('#meter-finish');
  const deliveryStatus = document.querySelector('#meter-delivery-status');
  const accessCode = document.querySelector('#meter-access-code');
  const archiveButton = document.querySelector('#meter-archive-load');
  const archive = document.querySelector('#meter-archive');
  const apiBase = document.querySelector('meta[name="meter-api"]').content.replace(/\/$/, '');
  const types = { strom: ['Strom', 'kWh'], wasser: ['Wasser', 'm³'], gas: ['Gas', 'm³'] };
  let db;
  let records = [];
  let preparedPhoto = null;
  let photoVersion = 0;
  let previewUrl;
  let historyUrls = [];
  let pendingBatch = null;
  let serviceReady = false;
  let sending = false;
  let mutating = false;

  function deliveryMessage(text, error = false) {
    deliveryStatus.textContent = text;
    deliveryStatus.dataset.error = String(error);
  }

  function updateCompletion() {
    const open = records.filter(record => !record.sentAt);
    const count = pendingBatch ? pendingBatch.recordIds.length : open.length;
    document.querySelector('#meter-pending-count').textContent = pendingBatch
      ? `Erfassung mit ${count} Ablesung(en) begonnen. Ein erneuter Versuch verwendet dieselbe Erfassungsnummer.`
      : `${count} offene Ablesung(en) für die nächste gemeinsame E-Mail.`;
    finishButton.disabled = !db || !serviceReady || sending || mutating || count === 0;
  }

  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}/api/${path}`, {
      ...options, headers: { 'Authorization': `Bearer ${accessCode.value}`, ...options.headers },
      cache: 'no-store', signal: AbortSignal.timeout(110000)
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('Der Speicher- und Versanddienst ist nicht erreichbar.'); }
    if (!response.ok) throw new Error(data.error || 'Die Übermittlung ist fehlgeschlagen.');
    return data;
  }

  async function checkService() {
    try {
      const response = await fetch(`${apiBase}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(10000) });
      const config = await response.json();
      if (!response.ok || config.storageReady !== true || config.recipient !== 'info@uhlenkoeper-camp.de') throw new Error();
      serviceReady = config.mailReady === true;
      archiveButton.disabled = false;
      deliveryMessage(serviceReady ? 'Speicher und E-Mail-Versand sind eingerichtet. Erfasse alle Werte und schließe die Erfassung anschließend ab.' : 'Der zentrale Speicher ist erreichbar. Der E-Mail-Versand muss noch eingerichtet werden.', !serviceReady);
    } catch {
      deliveryMessage('Zentrale Speicherung und E-Mail-Versand sind noch nicht erreichbar. Deine Entwürfe bleiben lokal erhalten.', true);
    }
    updateCompletion();
  }

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
    updateCompletion();
    for (const record of records) {
      const item = element('li', 'meter-entry');
      const [label, unit] = types[record.type];
      item.append(element('h4', '', record.meter));
      if (record.sentAt) item.append(element('span', 'meter-delivery-badge', 'Zentral gespeichert · E-Mail an Mailanbieter übergeben'));
      else if (record.cloudStored) item.append(element('span', 'meter-delivery-badge', 'Zentral gespeichert · Versand noch nicht bestätigt'));
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
      remove.disabled = sending || mutating || Boolean(pendingBatch?.recordIds.includes(record.id));
      remove.setAttribute('aria-label', `Ablesung für ${record.meter} vom ${record.date} löschen`);
      remove.addEventListener('click', async () => {
        if (sending || mutating || pendingBatch?.recordIds.includes(record.id)) return;
        if (!confirm(`Lokale Ablesung für „${record.meter}“ vom ${record.date} inklusive Foto auf diesem Gerät löschen? Zentral gespeicherte Kopien bleiben erhalten.`)) return;
        mutating = true;
        fields.disabled = true;
        updateCompletion();
        remove.disabled = true;
        try {
          await transaction('readwrite', store => store.delete(record.id));
          records = records.filter(entry => entry.id !== record.id);
          render();
          tell('Die lokale Ablesung und das lokale Foto wurden gelöscht. Zentral gespeicherte Kopien bleiben erhalten.');
          exportButton.disabled ? name.focus() : exportButton.focus();
        } catch {
          remove.disabled = false;
          tell('Die Ablesung konnte nicht gelöscht werden. Bitte erneut versuchen.', true);
        } finally {
          mutating = false;
          fields.disabled = false;
          render();
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

  async function savePending(batch) {
    await transactionState(store => batch ? store.put(batch) : store.delete('pending'));
    pendingBatch = batch;
  }

  function transactionState(action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readwrite');
      action(tx.objectStore('state'));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function photoBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    return btoa(binary);
  }

  finishButton.addEventListener('click', async () => {
    if (finishButton.disabled || sending) return;
    if (!accessCode.value) {
      deliveryMessage('Bitte den Zugangscode für das Camp eingeben.', true);
      accessCode.focus();
      return;
    }
    if (value.value.trim() || preparedPhoto || note.value.trim() || photo.files.length) {
      deliveryMessage('Im Formular ist noch eine ungespeicherte Ablesung. Bitte zuerst speichern oder die Eingaben leeren.', true);
      return;
    }
    sending = true;
    fields.disabled = true;
    archiveButton.disabled = true;
    updateCompletion();
    try {
      const selected = pendingBatch
        ? pendingBatch.recordIds.map(id => records.find(record => record.id === id))
        : records.filter(record => !record.sentAt);
      if (selected.some(record => !record)) throw new Error('Eine Ablesung der begonnenen Erfassung fehlt. Bitte die lokale Sicherung prüfen.');
      if (!selected.length || selected.length > 50) throw new Error('Eine Erfassung kann zwischen 1 und 50 Ablesungen enthalten.');
      if (selected.reduce((total, record) => total + record.photo.size, 0) > 8 * 1024 * 1024) throw new Error('Die Fotos sind zusammen größer als 8 MB. Bitte kleinere Fotos verwenden.');
      if (!pendingBatch) await savePending({ id: 'pending', batchId: crypto.randomUUID(), recordIds: selected.map(record => record.id) });
      render();
      deliveryMessage('Alle Ablesungen und Fotos werden zentral gespeichert. Anschließend wird die gemeinsame E-Mail versendet …');
      const readings = await Promise.all(selected.map(async record => ({
        localId: record.id, type: record.type, meter: record.meter, date: record.date,
        value: record.value, note: record.note, photo: await photoBase64(record.photo)
      })));
      const result = await api('submissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pendingBatch.batchId, readings }) });
      if (result.id !== pendingBatch.batchId || result.stored !== true) throw new Error('Die zentrale Speicherung konnte nicht bestätigt werden. Bitte erneut versuchen.');
      const sent = result.status === 'sent' && typeof result.sentAt === 'string';
      const updated = selected.map(record => ({ ...record, cloudStored: true, submissionId: result.id, ...(sent ? { sentAt: result.sentAt } : {}) }));
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['readings', 'state'], 'readwrite');
        updated.forEach(record => tx.objectStore('readings').put(record));
        if (sent) tx.objectStore('state').delete('pending');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      updated.forEach(record => { records[records.findIndex(entry => entry.id === record.id)] = record; });
      if (sent) pendingBatch = null;
      deliveryMessage(sent
        ? `${selected.length} Ablesung(en) mit Fotos sind zentral gespeichert. Die E-Mail an info@uhlenkoeper-camp.de wurde vom Mailanbieter angenommen. Erfassungsnummer: ${result.id}`
        : result.error || 'Die Daten sind zentral gespeichert. Der Versand läuft noch. Bitte den Status durch erneutes Abschließen prüfen.', !sent);
    } catch (error) {
      deliveryMessage(`${error.message || 'Die Übermittlung ist fehlgeschlagen.'} Deine lokalen Einträge bleiben erhalten. Bei erneutem Abschluss wird dieselbe Erfassungsnummer verwendet.`, true);
    } finally {
      sending = false;
      fields.disabled = false;
      archiveButton.disabled = false;
      render();
    }
  });

  archiveButton.addEventListener('click', async () => {
    if (!accessCode.value) {
      deliveryMessage('Bitte den Zugangscode für das Camp eingeben.', true);
      accessCode.focus();
      return;
    }
    archiveButton.disabled = true;
    try {
      const data = await api('submissions');
      if (!Array.isArray(data.submissions)) throw new Error('Der Dienst hat keine gültige Übersicht geliefert.');
      archive.replaceChildren();
      const labels = { stored: 'gespeichert, Versand ausstehend', sending: 'Versand läuft', uncertain: 'Versandstatus unklar', sent: 'an Mailanbieter übergeben' };
      for (const batch of data.submissions) {
        const details = element('details', '');
        details.append(element('summary', '', `${new Date(batch.createdAt).toLocaleString('de-DE')} · ${batch.readings.length} Ablesung(en) · ${labels[batch.status] || batch.status}`));
        details.append(element('p', '', `Erfassungsnummer: ${batch.id}`));
        batch.readings.forEach((record, index) => {
          const [label, unit] = types[record.type];
          details.append(element('p', '', `${label} · ${record.meter}\n${record.date} · ${record.value.toLocaleString('de-DE')} ${unit}${record.note ? `\n${record.note}` : ''}`));
          const button = element('button', 'meter-text-button', 'Gespeichertes Foto herunterladen ↓');
          button.type = 'button';
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              const response = await fetch(`${apiBase}/api/submissions/${batch.id}/photos/${index}`, { headers: { Authorization: `Bearer ${accessCode.value}` }, cache: 'no-store', signal: AbortSignal.timeout(30000) });
              if (!response.ok) throw new Error('Das Foto konnte nicht geladen werden. Bitte den Zugangscode prüfen.');
              download(await response.blob(), `zaehler-${batch.id}-${index + 1}.jpg`);
            } catch (error) { deliveryMessage(error.message, true); }
            finally { button.disabled = false; }
          });
          details.append(button);
        });
        archive.append(details);
      }
      deliveryMessage(`${data.submissions.length} zentral gespeicherte Erfassung(en) geladen (maximal die neuesten 100).`);
    } catch (error) { deliveryMessage(error.message, true); }
    finally { archiveButton.disabled = false; }
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
    const open = indexedDB.open('uhlenkoeper-meter-readings', 2);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('readings')) open.result.createObjectStore('readings', { keyPath: 'id', autoIncrement: true });
      if (!open.result.objectStoreNames.contains('state')) open.result.createObjectStore('state', { keyPath: 'id' });
    };
    open.onerror = () => tell('Der lokale Speicher ist nicht verfügbar. Bitte Browserspeicher zulassen und die Seite neu laden.', true);
    open.onblocked = () => tell('Bitte andere Tabs dieser Seite schließen und neu laden, um den lokalen Speicher zu öffnen.', true);
    open.onsuccess = async () => {
      db = open.result;
      db.onversionchange = () => {
        db.close();
        fields.disabled = true;
        serviceReady = false;
        updateCompletion();
        tell('Der lokale Speicher wurde in einem anderen Tab geändert. Bitte die Seite neu laden.', true);
      };
      try {
        records = await transaction('readonly', store => store.getAll());
        pendingBatch = await new Promise((resolve, reject) => {
          const tx = db.transaction('state', 'readonly');
          const request = tx.objectStore('state').get('pending');
          tx.oncomplete = () => resolve(request.result || null);
          tx.onerror = () => reject(tx.error);
        });
        records.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
        render();
        fields.disabled = false;
        tell('Bereit für deine nächste Ablesung.');
        checkService();
      } catch {
        tell('Gespeicherte Ablesungen konnten nicht geladen werden. Bitte die Seite neu laden.', true);
      }
    };
  } catch {
    tell('Dieser Browser stellt keinen lokalen Speicher bereit. Bitte einen Browser mit IndexedDB verwenden.', true);
  }
})();
