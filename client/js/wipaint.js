(function () {
    'use strict';

    const $ = id => document.getElementById(id);

    let canvas = null;
    let ctx = null;

    let tool = 'brush';
    let brush = 'classic';

    let drawing = false;
    let lastPoint = null;
    let startPoint = null;

    let history = [];
    let future = [];

    let layers = [];
    let activeLayer = 0;

    let selection = null;
    let clipboard = null;

    let transformMode = null;
    let transformStart = null;
    let transformOriginal = null;

    let zoom = 1;
    let grid = false;

    /*
     * ============================================================
     * UTILIDADES
     * ============================================================
     */

    function toast(message, type) {
        if (window.App?.toast) {
            window.App.toast(message, type);
        } else {
            console.log('[WifiPaint]', message);
        }
    }

    function currentLayer() {
        return layers[activeLayer];
    }

    function createLayer(name) {
        const c = document.createElement('canvas');

        c.width = canvas.width;
        c.height = canvas.height;

        return {
            name: name || `Camada ${layers.length + 1}`,
            canvas: c,
            visible: true,
            opacity: 1,
            locked: false,
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height
        };
    }

    function getColor() {
        return $('wipaint-color')?.value || '#7c5cff';
    }

    function getSize() {
        return Number($('wipaint-size')?.value || 12);
    }

    function getOpacity() {
        return Number($('wipaint-opacity')?.value || 100) / 100;
    }

    /*
     * ============================================================
     * CANVAS
     * ============================================================
     */

    function initCanvas() {
        canvas = $('wipaint-canvas');

        if (!canvas) {
            console.error('WifiPaint: canvas não encontrado.');
            return;
        }

        ctx = canvas.getContext('2d', {
            willReadFrequently: true
        });

        canvas.style.touchAction = 'none';

        layers = [
            createLayer('Camada 1')
        ];

        activeLayer = 0;

        history = [];
        future = [];

        addSelectionTool();

        createExtraControls();

        renderLayers();
        render();

        saveHistory();

        attachCanvasEvents();

        console.log('WifiPaint inicializado.');
    }

    function attachCanvasEvents() {
        canvas.onpointerdown = pointerDown;
        canvas.onpointermove = pointerMove;
        canvas.onpointerup = pointerUp;
        canvas.onpointercancel = pointerUp;

        window.addEventListener(
            'keydown',
            keyboard,
            true
        );
    }

    function getPosition(event) {
        const rect = canvas.getBoundingClientRect();

        const scaleX =
            canvas.width / rect.width;

        const scaleY =
            canvas.height / rect.height;

        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    }

    /*
     * ============================================================
     * RENDER
     * ============================================================
     */

    function render() {
        if (!canvas || !ctx) return;

        ctx.clearRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        ctx.fillStyle = '#ffffff';

        ctx.fillRect(
            0,
            0,
            canvas.width,
            canvas.height
        );

        for (const layer of layers) {
            if (!layer.visible) continue;

            ctx.save();

            ctx.globalAlpha = layer.opacity;

            ctx.drawImage(
                layer.canvas,
                layer.x,
                layer.y,
                layer.width,
                layer.height
            );

            ctx.restore();
        }

        if (grid) {
            drawGrid();
        }

        drawSelection();
    }

    function drawGrid() {
        ctx.save();

        ctx.globalAlpha = 0.16;
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;

        for (let x = 0; x < canvas.width; x += 16) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, canvas.height);
            ctx.stroke();
        }

        for (let y = 0; y < canvas.height; y += 16) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(canvas.width, y);
            ctx.stroke();
        }

        ctx.restore();
    }

    /*
     * ============================================================
     * SELEÇÃO / TRANSFORMAÇÃO
     * ============================================================
     */

    function getLayerBounds(layer) {
        return {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height
        };
    }

    function selectLayer() {
        const layer = currentLayer();

        if (!layer) return;

        selection = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height
        };

        render();
    }

    function selectAll() {
        selectLayer();

        toast(
            'Camada inteira selecionada.',
            'success'
        );
    }

    function clearSelection() {
        selection = null;
        transformMode = null;
        render();
    }

    function drawSelection() {
        if (!selection) return;

        const s = selection;

        ctx.save();

        ctx.strokeStyle = '#7c5cff';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 5]);

        ctx.strokeRect(
            s.x,
            s.y,
            s.width,
            s.height
        );

        ctx.setLineDash([]);

        const handles = getHandles(s);

        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#7c5cff';
        ctx.lineWidth = 2;

        for (const h of Object.values(handles)) {
            ctx.beginPath();

            ctx.rect(
                h.x - 5,
                h.y - 5,
                10,
                10
            );

            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }

    function getHandles(s) {
        return {
            nw: {
                x: s.x,
                y: s.y
            },

            n: {
                x: s.x + s.width / 2,
                y: s.y
            },

            ne: {
                x: s.x + s.width,
                y: s.y
            },

            e: {
                x: s.x + s.width,
                y: s.y + s.height / 2
            },

            se: {
                x: s.x + s.width,
                y: s.y + s.height
            },

            s: {
                x: s.x + s.width / 2,
                y: s.y + s.height
            },

            sw: {
                x: s.x,
                y: s.y + s.height
            },

            w: {
                x: s.x,
                y: s.y + s.height / 2
            }
        };
    }

    function findHandle(point) {
        if (!selection) return null;

        const handles = getHandles(selection);

        for (const [name, handle] of Object.entries(handles)) {
            const distance = Math.hypot(
                point.x - handle.x,
                point.y - handle.y
            );

            if (distance <= 12) {
                return name;
            }
        }

        return null;
    }

    function pointInsideSelection(point) {
        if (!selection) return false;

        return (
            point.x >= selection.x &&
            point.x <= selection.x + selection.width &&
            point.y >= selection.y &&
            point.y <= selection.y + selection.height
        );
    }

    function beginTransform(point, mode) {
        const layer = currentLayer();

        if (!layer || layer.locked) {
            toast(
                'Esta camada está bloqueada.',
                'error'
            );

            return false;
        }

        transformMode = mode;

        transformStart = {
            x: point.x,
            y: point.y
        };

        transformOriginal = {
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height
        };

        return true;
    }

    function transformLayer(point) {
        const layer = currentLayer();

        if (!layer || !transformMode) return;

        const original = transformOriginal;

        const dx =
            point.x - transformStart.x;

        const dy =
            point.y - transformStart.y;

        let x = original.x;
        let y = original.y;

        let width = original.width;
        let height = original.height;

        if (transformMode === 'move') {
            x = original.x + dx;
            y = original.y + dy;
        }

        if (transformMode.includes('e')) {
            width = Math.max(
                10,
                original.width + dx
            );
        }

        if (transformMode.includes('s')) {
            height = Math.max(
                10,
                original.height + dy
            );
        }

        if (transformMode.includes('w')) {
            width = Math.max(
                10,
                original.width - dx
            );

            x =
                original.x +
                original.width -
                width;
        }

        if (transformMode.includes('n')) {
            height = Math.max(
                10,
                original.height - dy
            );

            y =
                original.y +
                original.height -
                height;
        }

        if (
            transformMode !== 'move' &&
            !window.event?.shiftKey
        ) {
            // mantém transformação livre
        }

        layer.x = x;
        layer.y = y;
        layer.width = width;
        layer.height = height;

        selection = {
            x,
            y,
            width,
            height
        };

        render();
    }

    /*
     * ============================================================
     * DESENHO
     * ============================================================
     */

    function setupBrush(c) {
        c.globalAlpha = getOpacity();

        c.strokeStyle = getColor();
        c.fillStyle = getColor();

        c.lineWidth = getSize();

        c.lineCap =
            tool === 'pixel'
                ? 'butt'
                : 'round';

        c.lineJoin = 'round';

        if (tool === 'eraser') {
            c.globalCompositeOperation =
                'destination-out';
        } else {
            c.globalCompositeOperation =
                'source-over';
        }
    }

    function drawPoint(point) {
        const layer = currentLayer();

        if (!layer || layer.locked) return;

        const c =
            layer.canvas.getContext('2d');

        setupBrush(c);

        const local = {
            x: point.x - layer.x,
            y: point.y - layer.y
        };

        const scaleX =
            layer.canvas.width /
            layer.width;

        const scaleY =
            layer.canvas.height /
            layer.height;

        local.x *= scaleX;
        local.y *= scaleY;

        c.beginPath();

        c.arc(
            local.x,
            local.y,
            Math.max(
                0.5,
                getSize() / 2
            ),
            0,
            Math.PI * 2
        );

        c.fill();

        c.globalCompositeOperation =
            'source-over';
    }

    function drawLine(from, to) {
        const layer = currentLayer();

        if (!layer || layer.locked) return;

        const c =
            layer.canvas.getContext('2d');

        setupBrush(c);

        const sx =
            layer.canvas.width /
            layer.width;

        const sy =
            layer.canvas.height /
            layer.height;

        c.beginPath();

        c.moveTo(
            (from.x - layer.x) * sx,
            (from.y - layer.y) * sy
        );

        c.lineTo(
            (to.x - layer.x) * sx,
            (to.y - layer.y) * sy
        );

        c.stroke();

        c.globalCompositeOperation =
            'source-over';
    }

    function pointerDown(event) {
        if (event.button !== 0) return;

        event.preventDefault();

        const point =
            getPosition(event);

        if (tool === 'select') {
            const handle =
                findHandle(point);

            if (handle) {
                beginTransform(
                    point,
                    handle
                );

                return;
            }

            if (pointInsideSelection(point)) {
                beginTransform(
                    point,
                    'move'
                );

                return;
            }

            selectLayer();

            if (pointInsideSelection(point)) {
                beginTransform(
                    point,
                    'move'
                );
            }

            return;
        }

        const layer = currentLayer();

        if (!layer || layer.locked) {
            toast(
                'A camada está bloqueada.',
                'error'
            );

            return;
        }

        drawing = true;

        startPoint = point;
        lastPoint = point;

        if (
            tool === 'brush' ||
            tool === 'eraser' ||
            tool === 'pixel'
        ) {
            drawPoint(point);
            render();
        }

        if (tool === 'eyedropper') {
            const pixel =
                ctx.getImageData(
                    Math.floor(point.x),
                    Math.floor(point.y),
                    1,
                    1
                ).data;

            const color =
                '#' +
                [pixel[0], pixel[1], pixel[2]]
                    .map(
                        n =>
                            n
                                .toString(16)
                                .padStart(2, '0')
                    )
                    .join('');

            const colorInput =
                $('wipaint-color');

            if (colorInput) {
                colorInput.value = color;
            }

            drawing = false;
        }

        if (tool === 'fill') {
            const c =
                layer.canvas.getContext('2d');

            c.fillStyle = getColor();
            c.globalAlpha = getOpacity();

            c.fillRect(
                0,
                0,
                layer.canvas.width,
                layer.canvas.height
            );

            c.globalAlpha = 1;

            render();

            commit();

            drawing = false;
        }

        if (tool === 'text') {
            const text =
                prompt('Digite o texto:');

            if (text) {
                const c =
                    layer.canvas.getContext('2d');

                c.fillStyle = getColor();
                c.globalAlpha = getOpacity();

                c.font =
                    `600 ${Math.max(
                        14,
                        getSize() * 2
                    )}px Arial`;

                c.fillText(
                    text,
                    point.x - layer.x,
                    point.y - layer.y
                );

                c.globalAlpha = 1;

                render();

                commit();
            }

            drawing = false;
        }
    }

    function pointerMove(event) {
        const point =
            getPosition(event);

        if (tool === 'select' && transformMode) {
            transformLayer(point);
            return;
        }

        if (!drawing) return;

        event.preventDefault();

        if (
            tool === 'brush' ||
            tool === 'eraser' ||
            tool === 'pixel'
        ) {
            drawLine(
                lastPoint,
                point
            );

            lastPoint = point;

            render();
        }
    }

    function pointerUp(event) {
        if (transformMode) {
            transformMode = null;
            transformStart = null;
            transformOriginal = null;

            commit();

            return;
        }

        if (!drawing) return;

        drawing = false;

        if (
            tool === 'brush' ||
            tool === 'eraser' ||
            tool === 'pixel'
        ) {
            commit();
        }

        lastPoint = null;
        startPoint = null;
    }

    /*
     * ============================================================
     * COPIAR / COLAR
     * ============================================================
     */

    function copySelection() {
        if (!selection) {
            selectAll();
        }

        const s = selection;

        if (!s) return;

        const layer = currentLayer();

        const temp =
            document.createElement('canvas');

        temp.width =
            Math.max(1, Math.round(s.width));

        temp.height =
            Math.max(1, Math.round(s.height));

        const tc =
            temp.getContext('2d');

        tc.drawImage(
            layer.canvas,
            (s.x - layer.x) *
                layer.canvas.width /
                layer.width,

            (s.y - layer.y) *
                layer.canvas.height /
                layer.height,

            s.width *
                layer.canvas.width /
                layer.width,

            s.height *
                layer.canvas.height /
                layer.height,

            0,
            0,
            temp.width,
            temp.height
        );

        clipboard = {
            canvas: temp,
            x: s.x,
            y: s.y,
            width: s.width,
            height: s.height
        };

        toast(
            'Seleção copiada.',
            'success'
        );
    }

    function cutSelection() {
        copySelection();

        const layer = currentLayer();

        if (!layer || layer.locked) return;

        const c =
            layer.canvas.getContext('2d');

        c.clearRect(
            (selection.x - layer.x) *
                layer.canvas.width /
                layer.width,

            (selection.y - layer.y) *
                layer.canvas.height /
                layer.height,

            selection.width *
                layer.canvas.width /
                layer.width,

            selection.height *
                layer.canvas.height /
                layer.height
        );

        render();

        commit();

        toast(
            'Seleção recortada.',
            'success'
        );
    }

    function pasteSelection() {
        if (!clipboard) {
            toast(
                'Nada foi copiado.',
                'error'
            );

            return;
        }

        const layer =
            currentLayer();

        if (!layer || layer.locked) {
            toast(
                'A camada está bloqueada.',
                'error'
            );

            return;
        }

        const x =
            selection?.x ??
            clipboard.x + 20;

        const y =
            selection?.y ??
            clipboard.y + 20;

        const c =
            layer.canvas.getContext('2d');

        c.drawImage(
            clipboard.canvas,
            0,
            0,
            clipboard.width,
            clipboard.height,
            x - layer.x,
            y - layer.y,
            clipboard.width,
            clipboard.height
        );

        selection = {
            x,
            y,
            width: clipboard.width,
            height: clipboard.height
        };

        render();

        commit();

        toast(
            'Conteúdo colado.',
            'success'
        );
    }

    function deleteSelection() {
        if (!selection) return;

        const layer =
            currentLayer();

        if (!layer || layer.locked) {
            toast(
                'A camada está bloqueada.',
                'error'
            );

            return;
        }

        const c =
            layer.canvas.getContext('2d');

        c.clearRect(
            (selection.x - layer.x) *
                layer.canvas.width /
                layer.width,

            (selection.y - layer.y) *
                layer.canvas.height /
                layer.height,

            selection.width *
                layer.canvas.width /
                layer.width,

            selection.height *
                layer.canvas.height /
                layer.height
        );

        selection = null;

        render();

        commit();
    }

    /*
     * ============================================================
     * CAMADAS
     * ============================================================
     */

    function addLayer() {
        layers.push(
            createLayer(
                `Camada ${layers.length + 1}`
            )
        );

        activeLayer =
            layers.length - 1;

        selection = null;

        renderLayers();
        render();

        commit();
    }

    function duplicateLayer() {
        const source =
            currentLayer();

        if (!source) return;

        const layer =
            createLayer(
                `${source.name} cópia`
            );

        layer.x = source.x;
        layer.y = source.y;
        layer.width = source.width;
        layer.height = source.height;

        layer.opacity =
            source.opacity;

        layer.visible =
            source.visible;

        layer.locked = false;

        layer.canvas
            .getContext('2d')
            .drawImage(
                source.canvas,
                0,
                0
            );

        layers.splice(
            activeLayer + 1,
            0,
            layer
        );

        activeLayer++;

        renderLayers();
        render();

        commit();
    }

    function deleteLayer() {
        if (layers.length <= 1) {
            toast(
                'Você precisa manter uma camada.',
                'error'
            );

            return;
        }

        layers.splice(
            activeLayer,
            1
        );

        activeLayer =
            Math.max(
                0,
                activeLayer - 1
            );

        selection = null;

        renderLayers();
        render();

        commit();
    }

    function toggleLayerLock(index) {
        layers[index].locked =
            !layers[index].locked;

        renderLayers();

        toast(
            layers[index].locked
                ? 'Camada bloqueada.'
                : 'Camada desbloqueada.',
            'success'
        );
    }

    function toggleLayerVisibility(index) {
        layers[index].visible =
            !layers[index].visible;

        renderLayers();
        render();

        commit();
    }

    function moveLayerUp() {
        if (
            activeLayer >=
            layers.length - 1
        ) return;

        const temp =
            layers[activeLayer];

        layers[activeLayer] =
            layers[activeLayer + 1];

        layers[activeLayer + 1] =
            temp;

        activeLayer++;

        renderLayers();
        render();

        commit();
    }

    function moveLayerDown() {
        if (activeLayer <= 0) return;

        const temp =
            layers[activeLayer];

        layers[activeLayer] =
            layers[activeLayer - 1];

        layers[activeLayer - 1] =
            temp;

        activeLayer--;

        renderLayers();
        render();

        commit();
    }

    function renderLayers() {
        const box =
            $('wipaint-layers');

        if (!box) return;

        box.innerHTML =
            layers.map(
                (layer, index) => `
                    <div
                        class="wipaint-layer ${
                            index === activeLayer
                                ? 'active'
                                : ''
                        }"
                        data-layer="${index}"
                    >

                        <button
                            type="button"
                            class="wipaint-layer-icon"
                            data-visibility="${index}"
                            title="Mostrar/ocultar"
                        >
                            ${
                                layer.visible
                                    ? '👁️'
                                    : '🚫'
                            }
                        </button>

                        <span
                            class="wipaint-layer-name"
                        >
                            ${
                                layer.locked
                                    ? '🔒 '
                                    : ''
                            }${layer.name}
                        </span>

                        <button
                            type="button"
                            class="wipaint-layer-lock"
                            data-lock="${index}"
                            title="Bloquear camada"
                        >
                            ${
                                layer.locked
                                    ? '🔒'
                                    : '🔓'
                            }
                        </button>
                    </div>
                `
            ).join('');

        box
            .querySelectorAll('[data-layer]')
            .forEach(element => {
                element.onclick = () => {
                    activeLayer =
                        Number(
                            element.dataset.layer
                        );

                    selection = null;

                    renderLayers();
                    render();
                };
            });

        box
            .querySelectorAll(
                '[data-visibility]'
            )
            .forEach(button => {
                button.onclick = event => {
                    event.stopPropagation();

                    toggleLayerVisibility(
                        Number(
                            button.dataset.visibility
                        )
                    );
                };
            });

        box
            .querySelectorAll(
                '[data-lock]'
            )
            .forEach(button => {
                button.onclick = event => {
                    event.stopPropagation();

                    toggleLayerLock(
                        Number(
                            button.dataset.lock
                        )
                    );
                };
            });
    }

    /*
     * ============================================================
     * HISTÓRICO
     * ============================================================
     */

    function snapshot() {
        return layers.map(layer => ({
            name: layer.name,
            visible: layer.visible,
            opacity: layer.opacity,
            locked: layer.locked,
            x: layer.x,
            y: layer.y,
            width: layer.width,
            height: layer.height,
            data: layer.canvas.toDataURL(
                'image/png'
            )
        }));
    }

    function restore(state) {
        return Promise.all(
            state.map(item =>
                new Promise(resolve => {
                    const layer =
                        createLayer(
                            item.name
                        );

                    layer.visible =
                        item.visible;

                    layer.opacity =
                        item.opacity;

                    layer.locked =
                        item.locked;

                    layer.x =
                        item.x ?? 0;

                    layer.y =
                        item.y ?? 0;

                    layer.width =
                        item.width ??
                        canvas.width;

                    layer.height =
                        item.height ??
                        canvas.height;

                    const image =
                        new Image();

                    image.onload = () => {
                        layer.canvas
                            .getContext('2d')
                            .drawImage(
                                image,
                                0,
                                0
                            );

                        resolve(layer);
                    };

                    image.src =
                        item.data;
                })
            )
        ).then(newLayers => {
            layers = newLayers;

            activeLayer =
                Math.min(
                    activeLayer,
                    layers.length - 1
                );

            renderLayers();
            render();
        });
    }

    function saveHistory() {
        history.push(
            snapshot()
        );

        if (history.length > 40) {
            history.shift();
        }

        future = [];
    }

    async function undo() {
        if (history.length <= 1) {
            return;
        }

        const current =
            history.pop();

        future.push(current);

        await restore(
            history[
                history.length - 1
            ]
        );
    }

    async function redo() {
        if (!future.length) {
            return;
        }

        const state =
            future.pop();

        history.push(state);

        await restore(state);
    }

    function commit() {
        saveHistory();
    }

    /*
     * ============================================================
     * CONTROLES EXTRAS
     * ============================================================
     */

    function addSelectionTool() {
        const select =
            $('wipaint-tool');

        if (!select) return;

        if (
            !select.querySelector(
                'option[value="select"]'
            )
        ) {
            const option =
                document.createElement('option');

            option.value = 'select';
            option.textContent =
                '🎯 Seleção / Transformar';

            select.insertBefore(
                option,
                select.firstChild
            );
        }
    }

    function createExtraControls() {
        const toolbar =
            document.querySelector(
                '.wipaint-toolbar'
            );

        if (!toolbar) return;

        if ($('wipaint-copy')) return;

        const controls =
            document.createElement('div');

        controls.className =
            'wipaint-extra-controls';

        controls.innerHTML = `
            <button
                type="button"
                id="wipaint-select-all"
                class="btn btn-small"
                title="Ctrl+A"
            >
                🎯 Tudo
            </button>

            <button
                type="button"
                id="wipaint-copy"
                class="btn btn-small"
                title="Ctrl+C"
            >
                📋 Copiar
            </button>

            <button
                type="button"
                id="wipaint-cut"
                class="btn btn-small"
                title="Ctrl+X"
            >
                ✂️ Recortar
            </button>

            <button
                type="button"
                id="wipaint-paste"
                class="btn btn-small"
                title="Ctrl+V"
            >
                📥 Colar
            </button>

            <button
                type="button"
                id="wipaint-delete-selection"
                class="btn btn-small"
                title="Delete"
            >
                🗑️ Seleção
            </button>

            <button
                type="button"
                id="wipaint-duplicate-layer"
                class="btn btn-small"
            >
                📑 Duplicar
            </button>

            <button
                type="button"
                id="wipaint-layer-up"
                class="btn btn-small"
            >
                🔝 Subir
            </button>

            <button
                type="button"
                id="wipaint-layer-down"
                class="btn btn-small"
            >
                🔽 Descer
            </button>
        `;

        toolbar.appendChild(
            controls
        );

        $('wipaint-select-all')
            ?.addEventListener(
                'click',
                selectAll
            );

        $('wipaint-copy')
            ?.addEventListener(
                'click',
                copySelection
            );

        $('wipaint-cut')
            ?.addEventListener(
                'click',
                cutSelection
            );

        $('wipaint-paste')
            ?.addEventListener(
                'click',
                pasteSelection
            );

        $('wipaint-delete-selection')
            ?.addEventListener(
                'click',
                deleteSelection
            );

        $('wipaint-duplicate-layer')
            ?.addEventListener(
                'click',
                duplicateLayer
            );

        $('wipaint-layer-up')
            ?.addEventListener(
                'click',
                moveLayerUp
            );

        $('wipaint-layer-down')
            ?.addEventListener(
                'click',
                moveLayerDown
            );
    }

    /*
     * ============================================================
     * TECLADO
     * ============================================================
     */

    function keyboard(event) {
        const modifier =
            event.ctrlKey ||
            event.metaKey;

        /*
         * CTRL + A
         */
        if (
            modifier &&
            event.key.toLowerCase() === 'a'
        ) {
            event.preventDefault();
            event.stopPropagation();

            selectAll();

            return;
        }

        /*
         * CTRL + C
         */
        if (
            modifier &&
            event.key.toLowerCase() === 'c'
        ) {
            event.preventDefault();
            event.stopPropagation();

            copySelection();

            return;
        }

        /*
         * CTRL + X
         */
        if (
            modifier &&
            event.key.toLowerCase() === 'x'
        ) {
            event.preventDefault();
            event.stopPropagation();

            cutSelection();

            return;
        }

        /*
         * CTRL + V
         */
        if (
            modifier &&
            event.key.toLowerCase() === 'v'
        ) {
            event.preventDefault();
            event.stopPropagation();

            pasteSelection();

            return;
        }

        /*
         * CTRL + Z
         */
        if (
            modifier &&
            event.key.toLowerCase() === 'z' &&
            !event.shiftKey
        ) {
            event.preventDefault();
            event.stopPropagation();

            undo();

            return;
        }

        /*
         * CTRL + Y
         *
         * Também aceita CTRL + SHIFT + Z
         */
        if (
            modifier &&
            (
                event.key.toLowerCase() === 'y' ||
                (
                    event.key.toLowerCase() === 'z' &&
                    event.shiftKey
                )
            )
        ) {
            event.preventDefault();
            event.stopPropagation();

            redo();

            return;
        }

        /*
         * DELETE
         */
        if (
            event.key === 'Delete' &&
            selection
        ) {
            event.preventDefault();
            event.stopPropagation();

            deleteSelection();

            return;
        }

        /*
         * ESC
         */
        if (event.key === 'Escape') {
            clearSelection();
            return;
        }

        /*
         * Atalhos de ferramentas
         *
         * Só funcionam quando não estamos
         * digitando em um input.
         */
        const tag =
            document.activeElement?.tagName;

        if (
            tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            tag === 'SELECT'
        ) {
            return;
        }

        const key =
            event.key.toLowerCase();

        if (key === 'b')
            tool = 'brush';

        if (key === 'e')
            tool = 'eraser';

        if (key === 'v')
            tool = 'select';

        if (key === 'p')
            tool = 'pixel';

        if (key === 'i')
            tool = 'eyedropper';

        if (key === 't')
            tool = 'text';

        syncTool();
    }

    function syncTool() {
        const select =
            $('wipaint-tool');

        if (select) {
            select.value = tool;
        }
    }

    /*
     * ============================================================
     * IMAGEM
     * ============================================================
     */

    function loadImage(file) {
        if (!file) return;

        const image =
            new Image();

        image.onload = () => {
            const maxWidth = 1400;
            const maxHeight = 1000;

            const scale =
                Math.min(
                    1,
                    maxWidth / image.width,
                    maxHeight / image.height
                );

            canvas.width =
                Math.max(
                    1,
                    Math.round(
                        image.width * scale
                    )
                );

            canvas.height =
                Math.max(
                    1,
                    Math.round(
                        image.height * scale
                    )
                );

            ctx =
                canvas.getContext('2d');

            layers = [
                createLayer('Imagem')
            ];

            layers[0]
                .canvas
                .getContext('2d')
                .drawImage(
                    image,
                    0,
                    0,
                    canvas.width,
                    canvas.height
                );

            layers[0].width =
                canvas.width;

            layers[0].height =
                canvas.height;

            activeLayer = 0;

            history = [];
            future = [];

            selection = null;

            renderLayers();
            render();

            saveHistory();

            URL.revokeObjectURL(
                image.src
            );
        };

        image.src =
            URL.createObjectURL(file);
    }

    function savePNG() {
        const output =
            document.createElement(
                'canvas'
            );

        output.width =
            canvas.width;

        output.height =
            canvas.height;

        const outputCtx =
            output.getContext('2d');

        outputCtx.fillStyle =
            '#ffffff';

        outputCtx.fillRect(
            0,
            0,
            output.width,
            output.height
        );

        for (const layer of layers) {
            if (!layer.visible) continue;

            outputCtx.globalAlpha =
                layer.opacity;

            outputCtx.drawImage(
                layer.canvas,
                layer.x,
                layer.y,
                layer.width,
                layer.height
            );
        }

        outputCtx.globalAlpha = 1;

        const link =
            document.createElement('a');

        link.download =
            `wipaint-${Date.now()}.png`;

        link.href =
            output.toDataURL(
                'image/png'
            );

        link.click();
    }

    /*
     * ============================================================
     * BIND
     * ============================================================
     */

    function bind() {
        const openButton =
            $('wipaint-open-btn');

        if (!openButton) {
            console.warn(
                'WifiPaint: botão não encontrado.'
            );

            return;
        }

        openButton.onclick = () => {
            $('modal-overlay')
                ?.classList
                .remove('hidden');

            document
                .querySelectorAll('.modal')
                .forEach(
                    modal =>
                        modal.classList
                            .add('hidden')
                );

            $('modal-wipaint')
                ?.classList
                .remove('hidden');

            if (!canvas) {
                initCanvas();
            }
        };

        $('wipaint-tool')
            ?.addEventListener(
                'change',
                event => {
                    tool =
                        event.target.value;

                    selection = null;

                    render();
                }
            );

        $('wipaint-size')
            ?.addEventListener(
                'input',
                event => {
                    const label =
                        $('wipaint-size-value');

                    if (label) {
                        label.textContent =
                            `${event.target.value} px`;
                    }
                }
            );

        $('wipaint-zoom')
            ?.addEventListener(
                'input',
                event => {
                    zoom =
                        Number(
                            event.target.value
                        ) / 100;

                    canvas.style.transform =
                        `scale(${zoom})`;

                    canvas.style.transformOrigin =
                        'top left';

                    render();
                }
            );

        $('wipaint-undo')
            ?.addEventListener(
                'click',
                undo
            );

        $('wipaint-redo')
            ?.addEventListener(
                'click',
                redo
            );

        $('wipaint-grid')
            ?.addEventListener(
                'click',
                () => {
                    grid = !grid;
                    render();
                }
            );

        $('wipaint-clear')
            ?.addEventListener(
                'click',
                () => {
                    const layer =
                        currentLayer();

                    if (!layer || layer.locked) {
                        toast(
                            'A camada está bloqueada.',
                            'error'
                        );

                        return;
                    }

                    layer.canvas
                        .getContext('2d')
                        .clearRect(
                            0,
                            0,
                            layer.canvas.width,
                            layer.canvas.height
                        );

                    render();
                    commit();
                }
            );

        $('wipaint-add-layer')
            ?.addEventListener(
                'click',
                addLayer
            );

        $('wipaint-delete-layer')
            ?.addEventListener(
                'click',
                deleteLayer
            );

        $('wipaint-open-image')
            ?.addEventListener(
                'click',
                () =>
                    $('wipaint-file-input')
                        ?.click()
            );

        $('wipaint-file-input')
            ?.addEventListener(
                'change',
                event =>
                    loadImage(
                        event.target.files?.[0]
                    )
            );

        $('wipaint-save')
            ?.addEventListener(
                'click',
                savePNG
            );
    }

    document.addEventListener(
        'DOMContentLoaded',
        bind
    );

    window.WiPaint = {
        open: () =>
            $('wipaint-open-btn')?.click()
    };

})();
