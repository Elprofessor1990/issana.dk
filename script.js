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

const calcLab = document.querySelector('[data-calc-lab]');

if (calcLab) {
  const calcTabs = [...calcLab.querySelectorAll('[data-calc-target]')];
  const calcPanels = [...calcLab.querySelectorAll('[data-calc-panel]')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeCalc = 0;
  let calcTimer;
  let calcLabVisible = false;
  let calcLabPaused = false;

  const showCalculation = (index, moveFocus = false) => {
    activeCalc = (index + calcTabs.length) % calcTabs.length;
    const selectedName = calcTabs[activeCalc].dataset.calcTarget;

    calcTabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === activeCalc;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });

    calcPanels.forEach((panel) => {
      const selected = panel.dataset.calcPanel === selectedName;
      panel.hidden = !selected;
      panel.classList.toggle('is-active', selected);
    });

    calcTabs[activeCalc].scrollIntoView({
      behavior: reducedMotion.matches ? 'auto' : 'smooth',
      block: 'nearest',
      inline: 'nearest'
    });

    if (moveFocus) calcTabs[activeCalc].focus();
  };

  const stopCalcLoop = () => window.clearInterval(calcTimer);
  const startCalcLoop = () => {
    stopCalcLoop();
    if (reducedMotion.matches || !calcLabVisible || calcLabPaused) return;
    calcTimer = window.setInterval(() => showCalculation(activeCalc + 1), 3200);
  };

  calcTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      showCalculation(index);
      startCalcLoop();
    });
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? calcTabs.length - 1
          : activeCalc + (event.key === 'ArrowRight' ? 1 : -1);
      showCalculation(nextIndex, true);
      startCalcLoop();
    });
  });

  calcLab.addEventListener('mouseenter', () => { calcLabPaused = true; stopCalcLoop(); });
  calcLab.addEventListener('mouseleave', () => { calcLabPaused = false; startCalcLoop(); });
  calcLab.addEventListener('focusin', () => { calcLabPaused = true; stopCalcLoop(); });
  calcLab.addEventListener('focusout', (event) => {
    if (calcLab.contains(event.relatedTarget)) return;
    calcLabPaused = false;
    startCalcLoop();
  });

  reducedMotion.addEventListener?.('change', startCalcLoop);
  new IntersectionObserver(([entry]) => {
    calcLabVisible = entry.isIntersecting;
    startCalcLoop();
  }, { threshold: 0.25 }).observe(calcLab);
}

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
