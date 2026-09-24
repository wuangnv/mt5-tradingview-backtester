document.addEventListener('DOMContentLoaded', () => {
    const pageButtons = Array.from(document.querySelectorAll('[data-shell-page]'));
    const currentPage = document.getElementById('shell-current-page');
    const pageTitle = document.getElementById('shell-page-title');
    const pageEyebrow = document.getElementById('shell-page-eyebrow');
    const themeToggle = document.getElementById('shell-theme-toggle');

    function selectPage(button) {
        const page = button.dataset.shellPage;
        pageButtons.forEach((item) => item.classList.toggle('active', item === button));
        currentPage.textContent = page;
        pageTitle.textContent = page;
        pageEyebrow.textContent = page.toLocaleUpperCase('vi-VN');
    }

    pageButtons.forEach((button) => {
        button.addEventListener('click', () => selectPage(button));
    });

    themeToggle.addEventListener('click', () => {
        const root = document.documentElement;
        root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    });
});
