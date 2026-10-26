(function() {
    const slider = document.getElementById('height-scale-slider') || document.getElementById('line-width-slider');
    const valueLabel = document.getElementById('height-slider-value') || document.getElementById('line-width-value');

    if (!slider || !valueLabel) {
        return;
    }

    valueLabel.setAttribute('role', 'button');
    valueLabel.setAttribute('tabindex', '0');
    valueLabel.setAttribute('aria-label', 'Reset scale to 100%');
    valueLabel.title = 'Reset scale to 100%';

    const resetScale = event => {
        event.preventDefault();
        event.stopPropagation();
        slider.value = '100';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    };

    valueLabel.addEventListener('click', resetScale);
    valueLabel.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            resetScale(event);
        }
    });
})();
