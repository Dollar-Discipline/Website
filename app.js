// Reveal-on-scroll
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      io.unobserve(e.target);
    }
  }
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('[data-reveal]').forEach(el => io.observe(el));

// Gallery: drag to scroll
const gallery = document.querySelector('.gallery-scroll');
if (gallery) {
  let down = false, startX = 0, scrollLeft = 0;
  gallery.addEventListener('mousedown', (e) => {
    down = true;
    startX = e.pageX - gallery.offsetLeft;
    scrollLeft = gallery.scrollLeft;
    gallery.style.cursor = 'grabbing';
  });
  ['mouseleave', 'mouseup'].forEach(ev => gallery.addEventListener(ev, () => {
    down = false;
    gallery.style.cursor = 'grab';
  }));
  gallery.addEventListener('mousemove', (e) => {
    if (!down) return;
    e.preventDefault();
    const x = e.pageX - gallery.offsetLeft;
    gallery.scrollLeft = scrollLeft - (x - startX) * 1.5;
  });
  gallery.style.cursor = 'grab';
}

// Icons
if (window.lucide) window.lucide.createIcons();
