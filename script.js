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
    calcTimer = window.setInterval(() => showCalculation(activeCalc + 1), 2500);
  };

  calcTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      showCalculation(index);
      calcLabPaused = true;
      stopCalcLoop();
    });
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? calcTabs.length - 1
          : activeCalc + (event.key === 'ArrowRight' ? 1 : -1);
      showCalculation(nextIndex, true);
      calcLabPaused = true;
      stopCalcLoop();
    });
  });

  calcLab.addEventListener('mouseenter', stopCalcLoop);
  calcLab.addEventListener('mouseleave', startCalcLoop);
  calcLab.addEventListener('focusin', stopCalcLoop);
  calcLab.addEventListener('focusout', (event) => {
    if (calcLab.contains(event.relatedTarget)) return;
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
const submitButton = projectForm?.querySelector('[data-submit-button]');
const defaultFileLabel = 'Vælg PDF, PNG eller JPG — maks. 10 MB';
const maxFileSize = 10 * 1024 * 1024;

const setFormStatus = (message, type = '') => {
  if (!formStatus) return;
  formStatus.textContent = message;
  formStatus.classList.toggle('is-success', type === 'success');
  formStatus.classList.toggle('is-error', type === 'error');
};

fileInput?.addEventListener('change', () => {
  const selectedFile = fileInput.files?.[0];
  setFormStatus('');

  if (selectedFile && selectedFile.size > maxFileSize) {
    fileInput.value = '';
    if (fileLabel) fileLabel.textContent = defaultFileLabel;
    setFormStatus('Filen er større end 10 MB. Vælg en mindre fil.', 'error');
    return;
  }

  if (fileLabel) fileLabel.textContent = selectedFile?.name || defaultFileLabel;
});

projectForm?.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!projectForm.reportValidity()) return;

  const originalButtonContent = submitButton?.innerHTML;
  setFormStatus('Sender din henvendelse…');

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.textContent = 'Sender…';
  }

  try {
    const response = await fetch(projectForm.action, {
      method: 'POST',
      body: new FormData(projectForm),
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) throw new Error(`Formularen svarede med status ${response.status}`);

    projectForm.reset();
    if (fileLabel) fileLabel.textContent = defaultFileLabel;
    setFormStatus('Tak — din henvendelse er sendt. ISSANA vender tilbage hurtigst muligt.', 'success');
  } catch (error) {
    console.error(error);
    setFormStatus('Henvendelsen kunne ikke sendes. Prøv igen, eller skriv til info@issana.dk.', 'error');
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.removeAttribute('aria-busy');
      if (originalButtonContent) submitButton.innerHTML = originalButtonContent;
    }
  }
});
