(function() {
    const typeaheadTimeoutMs = 700;

    function installBusLinePicker(select) {
        const wrapper = document.createElement('div');
        wrapper.className = 'bus-line-picker';
        wrapper.style.width = select.style.width || '100%';

        const button = document.createElement('button');
        button.id = `${select.id}-picker`;
        button.type = 'button';
        button.className = 'bus-line-picker-button';
        button.setAttribute('role', 'combobox');
        button.setAttribute('aria-haspopup', 'listbox');
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', `${select.id}-options`);
        button.setAttribute('aria-label', document.querySelector(`label[for="${select.id}"]`)?.textContent.trim() || 'Select bus line');
        button.textContent = select.options[select.selectedIndex]?.textContent || select.options[0]?.textContent || 'Select line';

        const menu = document.createElement('div');
        menu.id = `${select.id}-options`;
        menu.className = 'bus-line-picker-options';
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;

        select.parentNode.insertBefore(wrapper, select);
        wrapper.append(button, select);
        wrapper.appendChild(menu);
        select.classList.add('bus-line-picker-native');
        const label = document.querySelector(`label[for="${select.id}"]`);
        if (label) {
            label.htmlFor = button.id;
        }

        let activeIndex = -1;
        let typeahead = '';
        let typeaheadTimeout = null;

        const getMenuOptions = () => Array.from(menu.querySelectorAll('.bus-line-picker-option'));

        const positionMenu = () => {
            const buttonRect = button.getBoundingClientRect();
            const gap = 4;
            const viewportPadding = 8;
            const spaceAbove = Math.max(0, buttonRect.top - viewportPadding - gap);
            const spaceBelow = Math.max(0, window.innerHeight - buttonRect.bottom - viewportPadding - gap);
            const openAbove = spaceAbove > spaceBelow;
            const maxHeight = Math.min(360, openAbove ? spaceAbove : spaceBelow);

            menu.style.maxHeight = `${maxHeight}px`;
            menu.style.width = `${buttonRect.width}px`;
            menu.style.left = `${Math.max(
                viewportPadding,
                Math.min(buttonRect.left, window.innerWidth - buttonRect.width - viewportPadding)
            )}px`;
            const menuHeight = Math.min(menu.scrollHeight, maxHeight);
            menu.style.top = openAbove
                ? `${Math.max(viewportPadding, buttonRect.top - menuHeight - gap)}px`
                : `${Math.min(window.innerHeight - menuHeight - viewportPadding, buttonRect.bottom + gap)}px`;
        };

        const syncPicker = () => {
            const selectedOption = select.options[select.selectedIndex];
            button.textContent = selectedOption?.textContent || select.options[0]?.textContent || 'Select line';
            getMenuOptions().forEach(option => {
                option.setAttribute('aria-selected', option.dataset.value === select.value ? 'true' : 'false');
            });
        };

        const closeMenu = () => {
            menu.hidden = true;
            button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-activedescendant');
        };

        const setActiveOption = index => {
            const options = getMenuOptions();
            if (!options.length) {
                activeIndex = -1;
                button.removeAttribute('aria-activedescendant');
                return;
            }

            activeIndex = (index + options.length) % options.length;
            options.forEach((option, optionIndex) => {
                option.classList.toggle('is-active', optionIndex === activeIndex);
            });
            const activeOption = options[activeIndex];
            button.setAttribute('aria-activedescendant', activeOption.id);
            activeOption.scrollIntoView({ block: 'nearest' });
        };

        const openMenu = () => {
            menu.hidden = false;
            button.setAttribute('aria-expanded', 'true');
            positionMenu();
            const selectedIndex = getMenuOptions().findIndex(option => option.dataset.value === select.value);
            setActiveOption(selectedIndex >= 0 ? selectedIndex : 0);
        };

        const chooseOption = value => {
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            syncPicker();
            closeMenu();
            button.focus();
        };

        const populateMenu = () => {
            menu.replaceChildren();
            Array.from(select.options).forEach((option, index) => {
                const menuOption = document.createElement('div');
                menuOption.id = `${select.id}-option-${index}`;
                menuOption.className = 'bus-line-picker-option';
                menuOption.setAttribute('role', 'option');
                menuOption.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
                menuOption.dataset.value = option.value;
                menuOption.textContent = option.textContent.trim();
                menuOption.addEventListener('click', () => chooseOption(option.value));
                menu.appendChild(menuOption);
            });
            syncPicker();
            if (!menu.hidden) {
                positionMenu();
            }
        };

        button.addEventListener('click', () => {
            if (menu.hidden) {
                openMenu();
            } else {
                closeMenu();
            }
        });

        button.addEventListener('keydown', event => {
            const optionCount = getMenuOptions().length;
            const isOpen = !menu.hidden;

            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!isOpen) {
                    openMenu();
                } else {
                    setActiveOption(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
                }
            } else if (event.key === 'Home' && isOpen) {
                event.preventDefault();
                setActiveOption(0);
            } else if (event.key === 'End' && isOpen) {
                event.preventDefault();
                setActiveOption(optionCount - 1);
            } else if ((event.key === 'Enter' || event.key === ' ') && isOpen) {
                event.preventDefault();
                const activeOption = menu.querySelector('.bus-line-picker-option.is-active');
                if (activeOption) {
                    chooseOption(activeOption.dataset.value || '');
                }
            } else if (event.key === 'Escape' && isOpen) {
                event.preventDefault();
                closeMenu();
            } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                typeahead += event.key.toLocaleLowerCase();
                window.clearTimeout(typeaheadTimeout);
                typeaheadTimeout = window.setTimeout(() => {
                    typeahead = '';
                }, typeaheadTimeoutMs);

                const matchIndex = getMenuOptions().findIndex(option => (
                    option.textContent.toLocaleLowerCase().startsWith(typeahead)
                ));
                if (matchIndex >= 0) {
                    if (!isOpen) {
                        openMenu();
                    }
                    setActiveOption(matchIndex);
                }
            }
        });

        document.addEventListener('pointerdown', event => {
            if (!menu.hidden && !wrapper.contains(event.target)) {
                closeMenu();
            }
        });

        window.addEventListener('resize', () => {
            if (!menu.hidden) {
                positionMenu();
            }
        });

        select.addEventListener('change', syncPicker);
        new MutationObserver(populateMenu).observe(select, { childList: true, subtree: true });
        populateMenu();
    }

    document.querySelectorAll('select.bus-line-typeahead').forEach(installBusLinePicker);
})();
