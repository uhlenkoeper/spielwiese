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
