const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const nav = document.querySelector('[data-nav]');

const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 24);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  nav?.classList.toggle('open', !open);
  document.body.style.overflow = open ? '' : 'hidden';
});

nav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuToggle?.setAttribute('aria-expanded', 'false');
    nav?.classList.remove('open');
    document.body.style.overflow = '';
  });
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((element, index) => {
  element.style.transitionDelay = `${Math.min(index % 4, 3) * 70}ms`;
  revealObserver.observe(element);
});

const projectForm = document.querySelector('[data-project-form]');
const fileInput = projectForm?.querySelector('input[type="file"]');
const fileLabel = projectForm?.querySelector('[data-file-label]');
const formStatus = projectForm?.querySelector('[data-form-status]');

fileInput?.addEventListener('change', () => {
  const selectedFile = fileInput.files?.[0];
  if (fileLabel) {
    fileLabel.textContent = selectedFile
      ? `${selectedFile.name} — husk at vedhæfte den i mailen`
      : 'Vælg fil — den vedhæftes i din mail';
  }
});

projectForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  if (!projectForm.reportValidity()) return;

  const values = new FormData(projectForm);
  const fileName = fileInput?.files?.[0]?.name || 'Ingen fil valgt';
  const subject = `Projektforespørgsel — ${values.get('adresse') || values.get('navn')}`;
  const body = [
    'Hej ISSANA',
    '',
    'Jeg vil gerne have vurderet mit projekt.',
    '',
    `Navn: ${values.get('navn')}`,
    `Telefon: ${values.get('telefon')}`,
    `E-mail: ${values.get('email')}`,
    `Projektadresse: ${values.get('adresse') || 'Ikke angivet'}`,
    '',
    'Opgave:',
    values.get('beskrivelse'),
    '',
    `Valgt fil: ${fileName}`,
    fileName === 'Ingen fil valgt' ? '' : 'HUSK: Vedhæft filen til denne mail, før den sendes.',
    '',
    'Venlig hilsen',
    values.get('navn')
  ].filter(Boolean).join('\n');

  if (formStatus) {
    formStatus.textContent = fileName === 'Ingen fil valgt'
      ? 'Dit mailprogram åbnes nu.'
      : 'Dit mailprogram åbnes nu. Husk at vedhæfte den valgte fil.';
  }

  window.location.href = `mailto:info@issana.dk?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});
