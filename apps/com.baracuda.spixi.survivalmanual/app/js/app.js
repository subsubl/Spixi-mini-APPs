document.addEventListener('DOMContentLoaded', () => {
    const menuContainer = document.getElementById('menu');
    const contentContainer = document.getElementById('markdown-content');
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-sidebar');

    // Toggle sidebar
    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    // Close sidebar when clicking outside on mobile
    document.addEventListener('click', (e) => {
        if (window.innerWidth <= 768 &&
            !sidebar.contains(e.target) &&
            !toggleBtn.contains(e.target) &&
            sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
    });

    // Simple Markdown Parser
    function parseMarkdown(text) {
        let html = text;

        // Headers
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
        html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>');
        html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>');

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
        html = html.replace(/__(.*?)__/gim, '<strong>$1</strong>');

        // Italic
        html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
        html = html.replace(/_(.*?)_/gim, '<em>$1</em>');

        // Images
        // Fix image paths to point to data directory if they are local
        html = html.replace(/!\[(.*?)\]\((.*?)\)/gim, (match, alt, url) => {
            if (!url.startsWith('http')) {
                // Remove any leading ./ or /
                url = url.replace(/^\.?\//, '');
                return `<img src="./data/${url}" alt="${alt}">`;
            }
            return `<img src="${url}" alt="${alt}">`;
        });

        // Links
        html = html.replace(/\[(.*?)\]\((.*?)\)/gim, (match, text, url) => {
            if (!url.startsWith('http')) {
                // Internal link
                return `<a href="#" data-link="${url}">${text}</a>`;
            }
            return `<a href="${url}" target="_blank">${text}</a>`;
        });

        // Blockquotes
        html = html.replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>');

        // Lists (basic)
        html = html.replace(/^\s*[\-\*] (.*$)/gim, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>'); // Wrap consecutive lis (very naive)
        // Better list wrapping would require more complex logic, but this is a start.
        // A slightly better approach for lists:
        // We can't easily do full list parsing with regex alone without state. 
        // For now, let's just make them block elements.

        // Paragraphs (double newline)
        html = html.replace(/\n\n/gim, '<br><br>');

        return html;
    }

    // Improved List Handling (Post-processing)
    function fixLists(html) {
        // This is still a bit hacky but better than nothing
        return html.replace(/<\/ul>\s*<ul>/gim, '');
    }

    async function loadContent(filename) {
        try {
            // Ensure filename ends with .md
            if (!filename.endsWith('.md')) {
                filename += '.md';
            }

            const response = await fetch(`./data/${filename}`);
            if (!response.ok) throw new Error(`Failed to load content: ${response.status} ${response.statusText}`);
            const text = await response.text();
            const html = parseMarkdown(text);
            contentContainer.innerHTML = fixLists(html);

            // Scroll to top
            contentContainer.scrollTop = 0;

            // Re-attach event listeners to new links
            const links = contentContainer.querySelectorAll('a[data-link]');
            links.forEach(link => {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    const target = link.getAttribute('data-link');
                    loadContent(target);
                    if (window.innerWidth <= 768) {
                        sidebar.classList.remove('open');
                    }
                });
            });

        } catch (error) {
            console.error(error);
            contentContainer.innerHTML = `<p>Error loading content: ${error.message}</p>`;
        }
    }

    async function buildMenu() {
        try {
            const response = await fetch('./data/Home.md');
            if (!response.ok) throw new Error(`Failed to load Home.md: ${response.status} ${response.statusText}`);
            const text = await response.text();

            // Parse Home.md specifically to build the menu
            // We expect lines like ### [Title](Filename)
            const lines = text.split('\n');
            const ul = document.createElement('ul');
            const menuItems = []; // Store items for search

            lines.forEach(line => {
                const match = line.match(/\[(.*?)\]\((.*?)\)/);
                if (match) {
                    const title = match[1];
                    const filename = match[2];

                    const li = document.createElement('li');
                    const a = document.createElement('a');
                    a.textContent = title;
                    a.href = '#';
                    a.addEventListener('click', (e) => {
                        e.preventDefault();
                        loadContent(filename);

                        // Update active state
                        document.querySelectorAll('#menu a').forEach(el => el.classList.remove('active'));
                        a.classList.add('active');

                        if (window.innerWidth <= 768) {
                            sidebar.classList.remove('open');
                        }
                    });
                    li.appendChild(a);
                    ul.appendChild(li);

                    menuItems.push({ li, title: title.toLowerCase() });
                }
            });

            menuContainer.appendChild(ul);

            // Search Functionality
            const searchInput = document.getElementById('search-input');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    menuItems.forEach(item => {
                        if (item.title.includes(term)) {
                            item.li.style.display = '';
                        } else {
                            item.li.style.display = 'none';
                        }
                    });
                });
            }

            // Load Introduction by default
            loadContent('Introduction');

        } catch (error) {
            console.error(error);
            menuContainer.innerHTML = `<p>Error loading menu: ${error.message}</p>`;
        }
    }

    buildMenu();
});
