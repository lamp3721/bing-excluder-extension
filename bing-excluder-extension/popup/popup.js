document.addEventListener('DOMContentLoaded', () => {
    const newItemInput = document.getElementById('newItemInput');
    const addItemButton = document.getElementById('addItemButton');
    const blacklistItemsUl = document.getElementById('blacklistItems');

    const STORAGE_KEY = 'managedBlacklist'; // Key for storing the list

    // --- Default Items ---
    const DEFAULT_BLACKLIST_ITEMS = [
        "example-domain.com",
        "bad-keyword",
        "another-site.org"
    ];

    // --- Load and Render Blacklist (with default population logic) ---
    function loadAndRenderBlacklist() {
        blacklistItemsUl.innerHTML = '<li class="loading-placeholder">Loading...</li>';

        chrome.storage.local.get([STORAGE_KEY], (result) => {
            let items = result[STORAGE_KEY]; // Get items

            // Check if storage is empty or doesn't exist (first load)
            if (items === undefined || items === null) {
                console.log("Blacklist storage empty, initializing with defaults.");
                items = [...DEFAULT_BLACKLIST_ITEMS]; // Use a copy of defaults

                // Save the defaults to storage immediately
                chrome.storage.local.set({ [STORAGE_KEY]: items }, () => {
                    console.log("Default blacklist saved to storage.");
                    renderBlacklist(items); // Render the newly added defaults
                });
            } else {
                 // Storage exists, render the items from storage
                 console.log("Loading blacklist from storage.");
                 renderBlacklist(items);
            }
        });
    }

    function renderBlacklist(items) {
        blacklistItemsUl.innerHTML = ''; // Clear previous items/loading state

        if (items.length === 0) {
            // This case should ideally not happen on first load due to default logic,
            // but good to keep for situations where user removes all items.
            blacklistItemsUl.innerHTML = '<li class="empty-placeholder">Blacklist is empty.</li>';
            return;
        }

        items.forEach((item, index) => {
            const li = document.createElement('li');
            const textSpan = document.createElement('span');
            textSpan.textContent = item;
            const removeButton = document.createElement('button');
            removeButton.textContent = 'Remove';
            removeButton.classList.add('remove-button');
            removeButton.addEventListener('click', () => {
                handleRemoveItem(index);
            });
            li.appendChild(textSpan);
            li.appendChild(removeButton);
            blacklistItemsUl.appendChild(li);
        });
    }

    // --- Add Item Logic ---
    function handleAddItem() {
        const newItem = newItemInput.value.trim();
        if (!newItem) return;

        chrome.storage.local.get([STORAGE_KEY], (result) => {
            // Ensure items is an array, even if storage was somehow corrupted
            const items = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

            if (items.some(item => item.toLowerCase() === newItem.toLowerCase())) {
                console.log(`Item "${newItem}" already exists.`);
                newItemInput.value = '';
                newItemInput.focus();
                return;
            }

            const updatedItems = [...items, newItem];

            chrome.storage.local.set({ [STORAGE_KEY]: updatedItems }, () => {
                console.log(`Added "${newItem}" to blacklist.`);
                renderBlacklist(updatedItems);
                newItemInput.value = '';
                newItemInput.focus();
            });
        });
    }

    // --- Remove Item Logic ---
    function handleRemoveItem(indexToRemove) {
        chrome.storage.local.get([STORAGE_KEY], (result) => {
            // Ensure items is an array
             const items = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

            if (indexToRemove < 0 || indexToRemove >= items.length) {
                console.error("Invalid index to remove:", indexToRemove);
                return;
            }

            const itemRemoved = items[indexToRemove];
            const updatedItems = items.filter((_, index) => index !== indexToRemove);

            chrome.storage.local.set({ [STORAGE_KEY]: updatedItems }, () => {
                console.log(`Removed "${itemRemoved}" from blacklist.`);
                renderBlacklist(updatedItems);
            });
        });
    }

    // --- Event Listeners ---
    addItemButton.addEventListener('click', handleAddItem);
    newItemInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            handleAddItem();
        }
    });

    // --- Initial Load ---
    loadAndRenderBlacklist();
});