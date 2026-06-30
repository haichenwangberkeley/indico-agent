document.addEventListener('DOMContentLoaded', () => {
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  
  let draggedCard = null;
  const errorMsgEl = document.getElementById('error-msg');
  const contentEl = document.getElementById('portal-content');
  const lastUpdatedEl = document.getElementById('last-updated');
  const retryBtn = document.getElementById('retry-btn');

  function parseSimpleMarkdown(text) {
    if (!text) return '';
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
      
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    html = html.replace(/^### (.*?)$/gm, '<h4 style="color:#ffffff; margin: 0.75rem 0 0.3rem 0; font-size:0.9rem;">$1</h4>');
    html = html.replace(/^## (.*?)$/gm, '<h3 style="color:#ffffff; margin: 1rem 0 0.4rem 0; font-size:0.95rem;">$1</h3>');
    html = html.replace(/^# (.*?)$/gm, '<h2 style="color:#ffffff; margin: 1.25rem 0 0.5rem 0; font-size:1rem;">$1</h2>');
    
    html = html.replace(/^\s*-\s+(.*?)$/gm, '&bull; $1<br>');
    html = html.replace(/^\s*\*\s+(.*?)$/gm, '&bull; $1<br>');
    html = html.replace(/^\s*(\d+)\.\s+(.*?)$/gm, '$1. $2<br>');
    
    // Parse Markdown tables by splitting lines
    const lines = html.split('\n');
    let inTable = false;
    let tableHtml = '';
    const outputLines = [];
    
    for (let line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        if (!inTable) {
          inTable = true;
          tableHtml = '<table style="width:100%; border-collapse:collapse; margin:1rem 0; font-size:0.8rem; border:1px solid rgba(139,92,246,0.15);">';
        }
        
        // Split cells
        const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
        
        // Skip divider rows like | :--- | :--- |
        if (cells.every(c => /^:?-+:?$/.test(c))) {
          continue;
        }
        
        tableHtml += '<tr style="border-bottom:1px solid rgba(139,92,246,0.1);">';
        const isHeader = !tableHtml.includes('</th>') && !tableHtml.includes('</td>');
        
        for (let cell of cells) {
          const tag = isHeader ? 'th' : 'td';
          const padding = '0.5rem 0.75rem';
          const style = `padding:${padding}; text-align:left; font-weight:${isHeader ? '600' : 'normal'}; color:${isHeader ? '#ffffff' : 'inherit'}; background:${isHeader ? 'rgba(139,92,246,0.06)' : 'transparent'};`;
          tableHtml += `<${tag} style="${style}">${cell}</${tag}>`;
        }
        tableHtml += '</tr>';
      } else {
        if (inTable) {
          inTable = false;
          tableHtml += '</table>';
          outputLines.push(tableHtml);
          tableHtml = '';
        }
        outputLines.push(line);
      }
    }
    
    if (inTable) {
      tableHtml += '</table>';
      outputLines.push(tableHtml);
    }
    
    html = outputLines.join('\n');
    
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    
    return `<p>${html}</p>`;
  }

  // Month names for badges
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function formatDateBadge(dateStr) {
    if (!dateStr) return { day: '--', month: '---' };
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const monthIdx = parseInt(parts[1], 10) - 1;
        const day = parts[2];
        return {
          day: day,
          month: MONTHS[monthIdx] || '---'
        };
      }
    } catch (e) {
      console.error("Error parsing date:", dateStr, e);
    }
    return { day: '??', month: '???' };
  }

  function formatTime(timeStr) {
    if (!timeStr) return '';
    // timeStr is usually HH:MM:SS, let's truncate seconds if present
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}`;
    }
    return timeStr;
  }

  async function fetchMeetings() {
    loadingEl.classList.remove('hidden');
    errorEl.classList.add('hidden');
    contentEl.classList.add('hidden');
    
    try {
      const response = await fetch('/api/meetings');
      if (!response.ok) {
        throw new Error(`API error (HTTP ${response.status})`);
      }
      const data = await response.json();
      renderPortal(data);
    } catch (err) {
      console.error(err);
      errorMsgEl.textContent = err.message || 'An error occurred while fetching Indico meetings.';
      errorEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
    }
  }

  function renderPortal(data) {
    contentEl.innerHTML = '';
    
    if (data.timestamp) {
      const dt = new Date(data.timestamp);
      lastUpdatedEl.textContent = `Sync Status: Active (Updated ${dt.toLocaleTimeString()})`;
    } else {
      lastUpdatedEl.textContent = '';
    }

    if (!data.categories || data.categories.length === 0) {
      contentEl.innerHTML = '<div class="state-container"><h2>No Categories Configured</h2><p>Please check your config/portal_categories.json.</p></div>';
      contentEl.classList.remove('hidden');
      loadingEl.classList.add('hidden');
      return;
    }

    data.categories.forEach(category => {
      const card = document.createElement('section');
      card.className = 'category-card';
      card.setAttribute('data-category-id', category.id);
      card.setAttribute('draggable', 'true');
      
      const meetingsCount = category.meetings ? category.meetings.length : 0;
      
      const hasActiveFilters = !!(category.require || category.exclude);

      // Category Header HTML
      let html = `
        <div class="drag-handle" title="Drag to reorder">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
            <circle cx="9" cy="5" r="2.25"/>
            <circle cx="9" cy="12" r="2.25"/>
            <circle cx="9" cy="19" r="2.25"/>
            <circle cx="15" cy="5" r="2.25"/>
            <circle cx="15" cy="12" r="2.25"/>
            <circle cx="15" cy="19" r="2.25"/>
          </svg>
        </div>
        <button class="delete-category-btn" data-category-id="${category.id}" title="Remove Category">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <div class="category-header">
          <div class="category-title-group">
            <h2 class="category-title">${category.name}</h2>
            <div style="display: flex; gap: 0.75rem; align-items: center;">
              <a href="${category.url}" target="_blank" class="category-link">
                View on CERN Indico
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </a>
              <button class="filter-toggle-btn ${hasActiveFilters ? 'active' : ''}" data-category-id="${category.id}" title="Filter Meetings">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
                Filters
              </button>
            </div>
          </div>
          <span class="meeting-count-badge">${meetingsCount} loaded</span>
        </div>

        <div class="filter-drawer" data-category-id="${category.id}">
          <div class="filter-row">
            <div class="filter-field">
              <label>Require in Title</label>
              <input type="text" class="filter-require" placeholder="e.g., Weekly meeting" value="${category.require || ''}">
            </div>
            <div class="filter-field">
              <label>Exclude in Title</label>
              <input type="text" class="filter-exclude" placeholder="e.g., Practice, draft" value="${category.exclude || ''}">
            </div>
          </div>
          <button class="btn btn-primary btn-save-filters" data-category-id="${category.id}">Apply Filters</button>
        </div>
      `;

      // Meetings List Container
      html += '<div class="meetings-list">';

      if (meetingsCount === 0) {
        html += '<p class="no-contribs">No meetings found in the current time window.</p>';
      } else {
        // Chronological order: from oldest to newest (so latest upcoming/latest past is at the end)
        category.meetings.forEach((meeting, idx) => {
          const badgeDate = formatDateBadge(meeting.date);
          const isUpcoming = meeting.is_upcoming;
          const statusBadge = isUpcoming ? '<span class="badge badge-upcoming">Upcoming</span>' : '<span class="badge badge-past">Past</span>';
          
          const timePlaceParts = [];
          if (meeting.time) timePlaceParts.push(formatTime(meeting.time));
          if (meeting.location) {
            let loc = meeting.location;
            if (meeting.room) loc += ` &bull; ${meeting.room}`;
            timePlaceParts.push(loc);
          }
          const timePlaceText = timePlaceParts.join(' &bull; ');

          // Expanded by default if it's the last meeting (most recent chronologically)
          const isLastMeeting = (idx === meetingsCount - 1);
          const expandClass = isLastMeeting ? 'expanded' : '';

          html += `
            <div class="meeting-item ${expandClass}" data-meeting-id="${meeting.id}">
              <div class="meeting-trigger">
                <div class="meeting-summary">
                  <div class="meeting-date-badge">
                    <span class="date-day">${badgeDate.day}</span>
                    <span class="date-month">${badgeDate.month}</span>
                  </div>
                  <div class="meeting-meta">
                    <h3 class="meeting-title" title="${meeting.title}">${meeting.title}</h3>
                    <div class="meeting-time-place">
                      ${statusBadge}
                      ${timePlaceText ? `<span>${timePlaceText}</span>` : ''}
                    </div>
                  </div>
                </div>
                <div class="arrow-icon">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
              <div class="meeting-content">
                <div class="meeting-details">
                  
                  <div class="action-row">
                    ${meeting.zoom_link ? `
                      <a href="${meeting.zoom_link}" target="_blank" class="btn btn-zoom">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7"></polygon>
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                        </svg>
                        Join Zoom Room
                      </a>
                    ` : `
                      <button class="btn" style="background: rgba(255,255,255,0.03); color: var(--text-muted); cursor: not-allowed;" disabled>
                        No Zoom Link Found
                      </button>
                    `}
                    <a href="${meeting.url}" target="_blank" class="btn btn-primary">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                      </svg>
                      Open Event Page
                    </a>
                    <button class="btn btn-summary-ai" data-meeting-id="${meeting.id}">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707.707M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z"/>
                      </svg>
                      Generate AI Summary
                    </button>
                  </div>

                  <div class="summary-section hidden" data-meeting-id="${meeting.id}">
                    <details class="summary-details" open>
                      <summary class="section-label" style="cursor: pointer; display: flex; align-items: center; gap: 0.4rem; user-select: none; outline: none;">
                        <svg class="summary-chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s;">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                        AI Executive Summary
                      </summary>
                      <div class="summary-content-box" style="margin-top: 0.5rem;"></div>
                    </details>
                  </div>

                  <div class="contributions-section">
                    <span class="section-label">Contributions</span>
                    ${(!meeting.contributions || meeting.contributions.length === 0) ? `
                      <p class="no-contribs">No contributions scheduled or exported for this event.</p>
                    ` : `
                      <div class="contrib-items">
                        ${meeting.contributions.map(contrib => `
                          <a href="${contrib.url}" target="_blank" class="contrib-item">
                            <div class="contrib-info">
                              <span class="contrib-title">${contrib.title}</span>
                              ${contrib.presenters ? `<span class="contrib-speaker">${contrib.presenters}</span>` : ''}
                            </div>
                            ${contrib.time ? `<span class="contrib-time">${formatTime(contrib.time)}</span>` : ''}
                          </a>
                        `).join('')}
                      </div>
                    `}
                  </div>

                </div>
              </div>
            </div>
          `;
        });
      }

      html += '</div>'; // close meetings-list
      card.innerHTML = html;
      contentEl.appendChild(card);

      // Drag and Drop listeners
      let dragStartOnHandle = false;
      const dragHandle = card.querySelector('.drag-handle');
      
      dragHandle.addEventListener('mousedown', () => {
        dragStartOnHandle = true;
      });
      dragHandle.addEventListener('mouseup', () => {
        dragStartOnHandle = false;
      });

      card.addEventListener('dragstart', (e) => {
        if (!dragStartOnHandle) {
          e.preventDefault();
          return;
        }
        draggedCard = card;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      card.addEventListener('dragend', async () => {
        card.classList.remove('dragging');
        draggedCard = null;
        dragStartOnHandle = false;
        await saveNewOrder();
      });

      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const targetCard = e.currentTarget;
        if (targetCard !== draggedCard) {
          const rect = targetCard.getBoundingClientRect();
          const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
          const container = document.getElementById('portal-content');
          container.insertBefore(draggedCard, next ? targetCard.nextSibling : targetCard);
        }
      });

      // Attach listener to delete button
      card.querySelector('.delete-category-btn').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const catId = btn.getAttribute('data-category-id');
        const parentCard = btn.closest('.category-card');
        
        if (confirm(`Are you sure you want to remove this category?`)) {
          parentCard.classList.add('removing');
          try {
            const res = await fetch(`/api/categories/${catId}`, { method: 'DELETE' });
            const resData = await res.json();
            if (!res.ok) {
              throw new Error(resData.error || 'Failed to delete category');
            }
            fetchMeetings();
          } catch (err) {
            alert(err.message);
            parentCard.classList.remove('removing');
          }
        }
      });

      // Attach listener to filters toggle button
      const filterToggleBtn = card.querySelector('.filter-toggle-btn');
      const filterDrawer = card.querySelector('.filter-drawer');
      filterToggleBtn.addEventListener('click', () => {
        if (filterDrawer.classList.contains('expanded')) {
          filterDrawer.style.maxHeight = '0px';
          filterDrawer.classList.remove('expanded');
          filterToggleBtn.classList.remove('active-toggle');
        } else {
          filterDrawer.style.maxHeight = filterDrawer.scrollHeight + 'px';
          filterDrawer.classList.add('expanded');
          filterToggleBtn.classList.add('active-toggle');
        }
      });

      // Attach listener to save filters button
      const saveFiltersBtn = card.querySelector('.btn-save-filters');
      saveFiltersBtn.addEventListener('click', async (e) => {
        const catId = e.currentTarget.getAttribute('data-category-id');
        const reqVal = card.querySelector('.filter-require').value.trim();
        const exVal = card.querySelector('.filter-exclude').value.trim();
        
        saveFiltersBtn.disabled = true;
        const originalBtnHtml = saveFiltersBtn.innerHTML;
        saveFiltersBtn.innerHTML = 'Applying...';
        
        try {
          const res = await fetch(`/api/categories/${catId}/filter`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ require: reqVal, exclude: exVal })
          });
          const resData = await res.json();
          if (!res.ok) {
            throw new Error(resData.error || 'Failed to update filters');
          }
          fetchMeetings();
        } catch (err) {
          alert(err.message);
          saveFiltersBtn.disabled = false;
          saveFiltersBtn.innerHTML = originalBtnHtml;
        }
      });

      // Attach listener to AI Summary buttons inside this card
      card.querySelectorAll('.btn-summary-ai').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const meetingId = btn.getAttribute('data-meeting-id');
          const summarySection = card.querySelector(`.summary-section[data-meeting-id="${meetingId}"]`);
          const summaryContent = summarySection.querySelector('.summary-content-box');
          const summaryDetails = summarySection.querySelector('.summary-details');
          
          // Helper to adjust parent accordion height
          const updateParentHeight = () => {
            const meetingContentEl = btn.closest('.meeting-content');
            if (meetingContentEl) {
              meetingContentEl.style.maxHeight = meetingContentEl.scrollHeight + 'px';
            }
          };

          // Attach toggle listener once
          if (summaryDetails && !summaryDetails.dataset.listenerAttached) {
            summaryDetails.dataset.listenerAttached = 'true';
            summaryDetails.addEventListener('toggle', updateParentHeight);
          }

          summarySection.classList.remove('hidden');
          summaryContent.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2.25px; margin: 0 0.5rem 0 0; display: inline-block; vertical-align: middle;"></span> Downloading slides and generating summary...';
          updateParentHeight();
          
          btn.disabled = true;
          const originalText = btn.innerHTML;
          btn.innerHTML = 'Generating...';
          
          try {
            const res = await fetch(`/api/meetings/${meetingId}/summary`, { method: 'POST' });
            const resData = await res.json();
            if (!res.ok) {
              throw new Error(resData.error || 'Failed to generate summary');
            }
            summaryContent.innerHTML = parseSimpleMarkdown(resData.summary);
          } catch (err) {
            summaryContent.innerHTML = `<span style="color: var(--error-color);">Error: ${err.message}</span>`;
          } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
            updateParentHeight();
          }
        });
      });
    });

    // Add click event listeners to meeting items for accordion functionality
    document.querySelectorAll('.meeting-trigger').forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        const item = trigger.closest('.meeting-item');
        const content = item.querySelector('.meeting-content');
        
        if (item.classList.contains('expanded')) {
          // Collapse
          content.style.maxHeight = '0px';
          item.classList.remove('expanded');
        } else {
          // Expand this item
          content.style.maxHeight = content.scrollHeight + 'px';
          item.classList.add('expanded');
          
          // Optional: Collapse siblings inside the same list if we want standard accordion behavior
          const siblingList = item.closest('.meetings-list');
          siblingList.querySelectorAll('.meeting-item').forEach(sibling => {
            if (sibling !== item && sibling.classList.contains('expanded')) {
              sibling.querySelector('.meeting-content').style.maxHeight = '0px';
              sibling.classList.remove('expanded');
            }
          });
        }
      });
    });

    // Initialize height for default expanded items
    document.querySelectorAll('.meeting-item.expanded').forEach(item => {
      const content = item.querySelector('.meeting-content');
      content.style.maxHeight = content.scrollHeight + 'px';
    });

    contentEl.classList.remove('hidden');
    loadingEl.classList.add('hidden');
  }

  retryBtn.addEventListener('click', fetchMeetings);

  // Category Add Form Submit
  const addCategoryForm = document.getElementById('add-category-form');
  const categoryUrlInput = document.getElementById('category-url');
  const addErrorEl = document.getElementById('add-error');
  const addCategoryBtn = document.getElementById('add-category-btn');

  addCategoryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addErrorEl.classList.add('hidden');
    addErrorEl.textContent = '';
    
    const urlVal = categoryUrlInput.value.trim();
    if (!urlVal) return;
    
    const originalBtnHtml = addCategoryBtn.innerHTML;
    addCategoryBtn.disabled = true;
    addCategoryBtn.innerHTML = '<span class="spinner" style="width: 14px; height: 14px; border-width: 2px; margin: 0; box-shadow: none; vertical-align: middle;"></span> Adding...';
    
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlVal })
      });
      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to add category');
      }
      categoryUrlInput.value = '';
      fetchMeetings();
    } catch (err) {
      console.error(err);
      addErrorEl.textContent = err.message;
      addErrorEl.classList.remove('hidden');
    } finally {
      addCategoryBtn.disabled = false;
      addCategoryBtn.innerHTML = originalBtnHtml;
    }
  });

  async function saveNewOrder() {
    const cards = document.querySelectorAll('.category-card');
    const order = Array.from(cards).map(card => card.getAttribute('data-category-id'));
    
    try {
      const res = await fetch('/api/categories/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
      if (!res.ok) {
        throw new Error('Failed to save category order');
      }
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  // Initial load
  fetchMeetings();
});
