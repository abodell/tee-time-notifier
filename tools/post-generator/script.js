document.addEventListener('DOMContentLoaded', () => {
    const slots = document.querySelectorAll('.slot');
    const previewGrid = document.getElementById('preview-grid');
    const generateBtn = document.getElementById('generate-all');
    const canvas = document.getElementById('processing-canvas');
    const ctx = canvas.getContext('2d');

    // Initialize state
    const state = {
        0: { photo: null, screenshot: null, fit: false },
        1: { photo: null, screenshot: null, fit: false },
        2: { photo: null, screenshot: null, fit: false },
        3: { photo: null, screenshot: null, fit: false }
    };

    // Render Preview
    function updatePreview() {
        previewGrid.innerHTML = '';
        for (let i = 0; i < 4; i++) {
            const rect = document.createElement('div');
            rect.className = 'preview-rect';
            rect.id = `preview-rect-${i}`;
            if (state[i].screenshot) {
                const img = document.createElement('img');
                img.src = state[i].screenshot;
                rect.appendChild(img);
            }

            const square = document.createElement('div');
            square.className = 'preview-square';
            square.id = `preview-square-${i}`;
            square.style.setProperty('--square-fit', state[i].fit ? 'contain' : 'cover');
            if (state[i].photo) {
                const img = document.createElement('img');
                img.src = state[i].photo;
                square.appendChild(img);
            }

            previewGrid.appendChild(rect);
            previewGrid.appendChild(square);
        }
    }

    // Handle File Uploads
    slots.forEach(slot => {
        const index = slot.dataset.index;
        const photoInput = slot.querySelector('#course-photo-' + index + ' .file-input');
        const screenshotInput = slot.querySelector('#app-screenshot-' + index + ' .file-input');
        const fitToggle = slot.querySelector('.fit-toggle');

        photoInput.addEventListener('change', (e) => handleFile(e, index, 'photo'));
        screenshotInput.addEventListener('change', (e) => handleFile(e, index, 'screenshot'));

        fitToggle.addEventListener('change', (e) => {
            state[index].fit = e.target.checked;
            updatePreview();
        });
    });

    function handleFile(e, index, type) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            state[index][type] = event.target.result;

            // Update UI
            const box = e.target.closest('.upload-box');
            box.classList.add('has-image');

            let img = box.querySelector('img');
            if (!img) {
                img = document.createElement('img');
                box.appendChild(img);
            }
            img.src = event.target.result;

            updatePreview();
        };
        reader.readAsDataURL(file);
    }

    // Image Processing & Download
    async function processAndDownload() {
        // High Resolution Composition
        const fullCanvas = document.createElement('canvas');
        fullCanvas.width = 1080;
        fullCanvas.height = 1080;
        const fctx = fullCanvas.getContext('2d');

        // White Background
        fctx.fillStyle = '#ffffff';
        fctx.fillRect(0, 0, 1080, 1080);

        const marginTop = 70;
        const marginBottom = 40;
        const colGap = 60;
        const innerGap = 15; // Gap between rect and square
        const rowGap = 40;   // Gap between slot pairs
        const itemWidth = 320; // Reduced to fit vertically

        // Center horizontally
        const marginSides = (1080 - (itemWidth * 2) - colGap) / 2;

        // Load all images
        const images = {};
        for (let i = 0; i < 4; i++) {
            if (state[i].photo) images[`p${i}`] = await loadImage(state[i].photo);
            if (state[i].screenshot) images[`s${i}`] = await loadImage(state[i].screenshot);
        }

        // Calculate Row Heights based on screenshots
        const getRectHeight = (idx) => {
            const img = images[`s${idx}`];
            if (!img) return 130; // default height if missing
            return (img.height / img.width) * itemWidth;
        };

        const row1RectH = Math.max(getRectHeight(0), getRectHeight(1));
        const row2RectH = Math.max(getRectHeight(2), getRectHeight(3));

        // Draw Row 1
        await drawSlot(fctx, images.p0, images.s0, marginSides, marginTop, itemWidth, row1RectH, innerGap, state[0].fit);
        await drawSlot(fctx, images.p1, images.s1, marginSides + itemWidth + colGap, marginTop, itemWidth, row1RectH, innerGap, state[1].fit);

        // Draw Row 2
        const row2Y = marginTop + row1RectH + innerGap + itemWidth + rowGap;
        await drawSlot(fctx, images.p2, images.s2, marginSides, row2Y, itemWidth, row2RectH, innerGap, state[2].fit);
        await drawSlot(fctx, images.p3, images.s3, marginSides + itemWidth + colGap, row2Y, itemWidth, row2RectH, innerGap, state[3].fit);

        const link = document.createElement('a');
        link.download = `tee_signal_post_${Date.now()}.png`;
        link.href = fullCanvas.toDataURL('image/png', 1.0);
        link.click();
    }

    function loadImage(url) {
        return new Promise(r => {
            const img = new Image();
            img.onload = () => r(img);
            img.src = url;
        });
    }

    async function drawSlot(ctx, photo, screenshot, x, y, width, rectH, gap, isFit) {
        // Draw Rectangle (Screenshot)
        if (screenshot) {
            ctx.drawImage(screenshot, x, y, width, (screenshot.height / screenshot.width) * width);
        } else {
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(x, y, width, rectH);
        }

        // Draw Square (Photo)
        const squareY = y + rectH + gap;
        ctx.fillStyle = '#f0f0f5';
        ctx.fillRect(x, squareY, width, width);

        if (photo) {
            if (isFit) {
                // Contain
                const ratio = Math.min(width / photo.width, width / photo.height);
                const nw = photo.width * ratio;
                const nh = photo.height * ratio;
                const nx = x + (width - nw) / 2;
                const ny = squareY + (width - nh) / 2;
                ctx.drawImage(photo, nx, ny, nw, nh);
            } else {
                // Cover
                const ratio = Math.max(width / photo.width, width / photo.height);
                const nw = photo.width * ratio;
                const nh = photo.height * ratio;
                const nx = x + (width - nw) / 2;
                const ny = squareY + (width - nh) / 2;
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, squareY, width, width);
                ctx.clip();
                ctx.drawImage(photo, nx, ny, nw, nh);
                ctx.restore();
            }
        }
    }

    generateBtn.addEventListener('click', processAndDownload);

    // Global Paste Listener
    window.addEventListener('paste', (e) => {
        const activeElement = document.activeElement;
        if (!activeElement || !activeElement.classList.contains('upload-box')) return;

        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const boxId = activeElement.id; // e.g., "course-photo-0"
                    const parts = boxId.split('-');
                    const type = parts[1]; // "photo" or "screenshot"
                    const index = parts[2];

                    state[index][type] = event.target.result;

                    // Update UI
                    activeElement.classList.add('has-image');
                    let img = activeElement.querySelector('img');
                    if (!img) {
                        img = document.createElement('img');
                        activeElement.appendChild(img);
                    }
                    img.src = event.target.result;

                    updatePreview();
                };
                reader.readAsDataURL(blob);
                break; // Only handle the first image
            }
        }
    });

    // Initial render
    updatePreview();
});
