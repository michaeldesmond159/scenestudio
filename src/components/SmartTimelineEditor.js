const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : `clip-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const deepClone = (value) => JSON.parse(JSON.stringify(value));

const normalizeClip = (clip, index = 0) => {
    const sourceDuration = Math.max(0.1, Number(clip.sourceDuration || clip.duration || 5));
    const trimStart = clamp(Number(clip.trimStart || 0), 0, sourceDuration - 0.05);
    const trimEnd = clamp(Number(clip.trimEnd ?? sourceDuration), trimStart + 0.05, sourceDuration);
    return {
        id: clip.id || uid(),
        sourceUrl: clip.sourceUrl || clip.url || '',
        sourceDuration,
        trimStart,
        trimEnd,
        timelineStart: Number(clip.timelineStart || 0),
        order: Number.isFinite(clip.order) ? clip.order : index,
        volume: Number.isFinite(clip.volume) ? clip.volume : 1,
        muted: Boolean(clip.muted),
        label: clip.label || `Scene ${index + 1}`,
        model: clip.model || null,
        prompt: clip.prompt || '',
    };
};

const clipDuration = (clip) => Math.max(0.05, clip.trimEnd - clip.trimStart);

const packTimeline = (clips) => {
    let cursor = 0;
    return clips
        .sort((a, b) => a.order - b.order)
        .map((clip, index) => {
            const next = { ...clip, order: index, timelineStart: cursor };
            cursor += clipDuration(next);
            return next;
        });
};

export function SmartTimelineEditor({
    clips = [],
    initialPlayhead = 0,
    onChange = () => {},
    onClose = () => {},
} = {}) {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[300] bg-[#070707] text-white flex flex-col overflow-hidden';

    let state = packTimeline((clips.length ? clips : []).map(normalizeClip));
    let selectedId = state[0]?.id || null;
    let playhead = Math.max(0, Number(initialPlayhead || 0));
    let zoom = 48; // pixels per second
    let isPlaying = false;
    let raf = null;
    let lastTick = 0;
    let dragState = null;
    let undoStack = [];
    let redoStack = [];
    let activeVideoClipId = null;

    const totalDuration = () => state.reduce((sum, clip) => sum + clipDuration(clip), 0);
    const selectedClip = () => state.find(c => c.id === selectedId) || null;

    const commit = (mutator) => {
        undoStack.push(deepClone(state));
        if (undoStack.length > 100) undoStack.shift();
        redoStack = [];
        const draft = deepClone(state);
        const result = mutator(draft) || draft;
        state = packTimeline(result.map(normalizeClip));
        playhead = clamp(playhead, 0, Math.max(0, totalDuration()));
        onChange(deepClone(state));
        renderTimeline();
        syncPreviewToPlayhead();
        updateToolbarState();
    };

    const undo = () => {
        if (!undoStack.length) return;
        redoStack.push(deepClone(state));
        state = packTimeline(undoStack.pop().map(normalizeClip));
        if (!state.some(c => c.id === selectedId)) selectedId = state[0]?.id || null;
        playhead = clamp(playhead, 0, totalDuration());
        onChange(deepClone(state));
        renderTimeline();
        syncPreviewToPlayhead();
        updateToolbarState();
    };

    const redo = () => {
        if (!redoStack.length) return;
        undoStack.push(deepClone(state));
        state = packTimeline(redoStack.pop().map(normalizeClip));
        if (!state.some(c => c.id === selectedId)) selectedId = state[0]?.id || null;
        playhead = clamp(playhead, 0, totalDuration());
        onChange(deepClone(state));
        renderTimeline();
        syncPreviewToPlayhead();
        updateToolbarState();
    };

    root.innerHTML = `
        <div class="h-14 border-b border-white/10 bg-black/70 backdrop-blur-xl flex items-center justify-between px-4 md:px-6 shrink-0">
            <div class="flex items-center gap-3">
                <button data-action="close" class="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center" title="Back">←</button>
                <div>
                    <div class="text-sm font-black tracking-wide">Smart Timeline Editor</div>
                    <div class="text-[10px] text-white/40">Non-destructive editing</div>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button data-action="undo" class="toolbar-btn" title="Undo (⌘/Ctrl+Z)">↶</button>
                <button data-action="redo" class="toolbar-btn" title="Redo (⌘/Ctrl+Shift+Z)">↷</button>
                <button data-action="export-json" class="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-bold">Project JSON</button>
            </div>
        </div>

        <div class="flex-1 min-h-0 grid grid-rows-[minmax(0,1fr)_auto]">
            <div class="min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-0">
                <div class="min-h-0 flex items-center justify-center p-4 md:p-6 bg-[#0a0a0a]">
                    <div class="relative w-full h-full min-h-[240px] flex items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black">
                        <video data-role="preview" class="max-w-full max-h-full object-contain" playsinline></video>
                        <div data-role="empty-preview" class="absolute inset-0 flex items-center justify-center text-white/30 text-sm">Add a clip to start editing</div>
                        <div class="absolute left-3 bottom-3 bg-black/70 backdrop-blur px-2.5 py-1.5 rounded-lg text-[10px] font-mono border border-white/10">
                            <span data-role="current-time">00:00.00</span> / <span data-role="total-time">00:00.00</span>
                        </div>
                    </div>
                </div>

                <aside class="hidden lg:flex flex-col border-l border-white/10 bg-[#0d0d0d] p-4 gap-4 overflow-y-auto">
                    <div class="text-[10px] font-black uppercase tracking-[0.18em] text-white/40">Clip Inspector</div>
                    <div data-role="inspector-empty" class="text-xs text-white/30">Select a clip.</div>
                    <div data-role="inspector" class="hidden flex-col gap-4">
                        <label class="space-y-1.5">
                            <span class="text-[10px] text-white/50 uppercase tracking-wider">Name</span>
                            <input data-field="label" class="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/50" />
                        </label>
                        <label class="space-y-1.5">
                            <span class="text-[10px] text-white/50 uppercase tracking-wider">Trim start</span>
                            <input data-field="trimStart" type="number" step="0.05" min="0" class="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/50" />
                        </label>
                        <label class="space-y-1.5">
                            <span class="text-[10px] text-white/50 uppercase tracking-wider">Trim end</span>
                            <input data-field="trimEnd" type="number" step="0.05" min="0" class="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-primary/50" />
                        </label>
                        <label class="space-y-1.5">
                            <span class="text-[10px] text-white/50 uppercase tracking-wider">Volume</span>
                            <input data-field="volume" type="range" min="0" max="1" step="0.01" class="w-full" />
                        </label>
                        <label class="flex items-center justify-between text-xs">
                            <span class="text-white/60">Muted</span>
                            <input data-field="muted" type="checkbox" />
                        </label>
                        <div data-role="clip-meta" class="rounded-xl bg-white/[0.03] border border-white/10 p-3 text-[10px] text-white/40 leading-relaxed"></div>
                    </div>
                </aside>
            </div>

            <div class="border-t border-white/10 bg-[#0b0b0b] shrink-0">
                <div class="h-12 border-b border-white/10 flex items-center gap-2 px-3 md:px-4 overflow-x-auto">
                    <button data-action="play" class="toolbar-btn" title="Play/Pause (Space)">▶</button>
                    <div class="w-px h-5 bg-white/10 mx-1"></div>
                    <button data-action="split" class="toolbar-btn-wide" title="Split at playhead (S)">✂ Split</button>
                    <button data-action="duplicate" class="toolbar-btn-wide" title="Duplicate clip">⧉ Duplicate</button>
                    <button data-action="delete" class="toolbar-btn-wide text-red-300" title="Delete (Backspace)">⌫ Delete</button>
                    <div class="w-px h-5 bg-white/10 mx-1"></div>
                    <div class="ml-auto flex items-center gap-2 min-w-[180px]">
                        <span class="text-[10px] text-white/40">Zoom</span>
                        <input data-role="zoom" type="range" min="24" max="160" value="48" class="w-28" />
                        <span data-role="zoom-label" class="text-[10px] font-mono text-white/50 w-10">48px</span>
                    </div>
                </div>

                <div data-role="timeline-scroll" class="overflow-x-auto overflow-y-hidden custom-scrollbar">
                    <div data-role="timeline" class="relative h-44 min-w-full select-none" style="width:100%">
                        <div data-role="ruler" class="absolute left-0 right-0 top-0 h-7 border-b border-white/10 bg-black/20"></div>
                        <div class="absolute left-0 right-0 top-7 bottom-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,.02)_1px,transparent_1px)] bg-[length:100%_32px]"></div>
                        <div data-role="clips" class="absolute left-0 right-0 top-10 h-20"></div>
                        <div data-role="playhead" class="absolute top-0 bottom-0 w-px bg-primary z-30 pointer-events-none">
                            <div class="absolute -left-[5px] top-0 w-[11px] h-[11px] bg-primary rotate-45 rounded-[2px]"></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Shared button styles without relying on a CSS build step.
    root.querySelectorAll('.toolbar-btn').forEach(btn => btn.className += ' w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-25 border border-white/10 flex items-center justify-center text-xs font-bold transition-colors');
    root.querySelectorAll('.toolbar-btn-wide').forEach(btn => btn.className += ' px-3 h-9 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-25 border border-white/10 flex items-center justify-center text-[11px] font-bold whitespace-nowrap transition-colors');

    const preview = root.querySelector('[data-role="preview"]');
    const emptyPreview = root.querySelector('[data-role="empty-preview"]');
    const currentTimeEl = root.querySelector('[data-role="current-time"]');
    const totalTimeEl = root.querySelector('[data-role="total-time"]');
    const timeline = root.querySelector('[data-role="timeline"]');
    const ruler = root.querySelector('[data-role="ruler"]');
    const clipsLayer = root.querySelector('[data-role="clips"]');
    const playheadEl = root.querySelector('[data-role="playhead"]');
    const timelineScroll = root.querySelector('[data-role="timeline-scroll"]');
    const zoomInput = root.querySelector('[data-role="zoom"]');
    const zoomLabel = root.querySelector('[data-role="zoom-label"]');
    const inspector = root.querySelector('[data-role="inspector"]');
    const inspectorEmpty = root.querySelector('[data-role="inspector-empty"]');
    const clipMeta = root.querySelector('[data-role="clip-meta"]');

    const formatTime = (seconds) => {
        const value = Math.max(0, Number(seconds || 0));
        const mins = Math.floor(value / 60).toString().padStart(2, '0');
        const secs = Math.floor(value % 60).toString().padStart(2, '0');
        const hundredths = Math.floor((value % 1) * 100).toString().padStart(2, '0');
        return `${mins}:${secs}.${hundredths}`;
    };

    const getClipAtTime = (time) => state.find(clip => time >= clip.timelineStart && time < clip.timelineStart + clipDuration(clip)) || state[state.length - 1] || null;

    const syncPreviewToPlayhead = () => {
        totalTimeEl.textContent = formatTime(totalDuration());
        currentTimeEl.textContent = formatTime(playhead);
        playheadEl.style.left = `${playhead * zoom}px`;

        const clip = getClipAtTime(playhead);
        if (!clip?.sourceUrl) {
            preview.removeAttribute('src');
            emptyPreview.classList.remove('hidden');
            activeVideoClipId = null;
            return;
        }

        emptyPreview.classList.add('hidden');
        const localTime = clamp(playhead - clip.timelineStart + clip.trimStart, clip.trimStart, clip.trimEnd);
        if (activeVideoClipId !== clip.id || preview.src !== clip.sourceUrl) {
            activeVideoClipId = clip.id;
            preview.src = clip.sourceUrl;
            preview.muted = clip.muted;
            preview.volume = clamp(clip.volume, 0, 1);
            preview.onloadedmetadata = () => {
                try { preview.currentTime = localTime; } catch (_) {}
                if (isPlaying) preview.play().catch(() => {});
            };
        } else if (Math.abs(preview.currentTime - localTime) > 0.18 || !isPlaying) {
            try { preview.currentTime = localTime; } catch (_) {}
        }
        preview.muted = clip.muted;
        preview.volume = clamp(clip.volume, 0, 1);
    };

    const renderRuler = () => {
        ruler.innerHTML = '';
        const duration = Math.max(totalDuration(), 10);
        const step = zoom >= 100 ? 1 : zoom >= 50 ? 2 : 5;
        for (let t = 0; t <= duration + step; t += step) {
            const mark = document.createElement('div');
            mark.className = 'absolute top-0 h-full border-l border-white/10 text-[9px] font-mono text-white/30 pl-1 pt-1';
            mark.style.left = `${t * zoom}px`;
            mark.textContent = `${t}s`;
            ruler.appendChild(mark);
        }
    };

    const createClipElement = (clip) => {
        const el = document.createElement('div');
        const width = Math.max(28, clipDuration(clip) * zoom);
        el.dataset.clipId = clip.id;
        el.draggable = false;
        el.className = `absolute top-0 h-16 rounded-xl border overflow-hidden cursor-pointer group transition-[border-color,box-shadow] ${selectedId === clip.id ? 'border-primary shadow-[0_0_0_1px_rgba(34,211,238,.35)]' : 'border-white/10 hover:border-white/30'}`;
        el.style.left = `${clip.timelineStart * zoom}px`;
        el.style.width = `${width}px`;
        el.innerHTML = `
            <div class="absolute inset-0 bg-gradient-to-r from-cyan-950/70 via-slate-900/90 to-cyan-950/70"></div>
            ${clip.sourceUrl ? `<video src="${clip.sourceUrl}" preload="metadata" muted class="absolute inset-0 w-full h-full object-cover opacity-35 pointer-events-none"></video>` : ''}
            <div class="absolute inset-0 flex items-center px-3 pointer-events-none">
                <div class="min-w-0">
                    <div class="text-[10px] font-black truncate">${clip.label}</div>
                    <div class="text-[9px] text-white/50 font-mono">${clipDuration(clip).toFixed(2)}s</div>
                </div>
            </div>
            <div data-handle="left" class="absolute left-0 top-0 bottom-0 w-2.5 bg-primary/70 opacity-0 group-hover:opacity-100 cursor-ew-resize z-10"></div>
            <div data-handle="right" class="absolute right-0 top-0 bottom-0 w-2.5 bg-primary/70 opacity-0 group-hover:opacity-100 cursor-ew-resize z-10"></div>
        `;

        el.addEventListener('mousedown', (event) => {
            event.preventDefault();
            selectedId = clip.id;
            const handle = event.target.closest('[data-handle]')?.dataset.handle;
            dragState = {
                type: handle ? `trim-${handle}` : 'reorder',
                clipId: clip.id,
                startX: event.clientX,
                originalState: deepClone(state),
                originalClip: deepClone(clip),
            };
            renderTimeline();
            renderInspector();
            updateToolbarState();
        });

        el.addEventListener('dblclick', () => {
            selectedId = clip.id;
            playhead = clip.timelineStart;
            renderTimeline();
            renderInspector();
            syncPreviewToPlayhead();
        });
        return el;
    };

    const renderTimeline = () => {
        const width = Math.max(timelineScroll.clientWidth || 800, Math.max(totalDuration(), 10) * zoom + 120);
        timeline.style.width = `${width}px`;
        clipsLayer.innerHTML = '';
        state.forEach(clip => clipsLayer.appendChild(createClipElement(clip)));
        renderRuler();
        playheadEl.style.left = `${playhead * zoom}px`;
        currentTimeEl.textContent = formatTime(playhead);
        totalTimeEl.textContent = formatTime(totalDuration());
        renderInspector();
    };

    const renderInspector = () => {
        const clip = selectedClip();
        if (!clip) {
            inspector.classList.add('hidden');
            inspector.classList.remove('flex');
            inspectorEmpty.classList.remove('hidden');
            return;
        }
        inspectorEmpty.classList.add('hidden');
        inspector.classList.remove('hidden');
        inspector.classList.add('flex');
        inspector.querySelector('[data-field="label"]').value = clip.label;
        inspector.querySelector('[data-field="trimStart"]').value = clip.trimStart.toFixed(2);
        inspector.querySelector('[data-field="trimEnd"]').value = clip.trimEnd.toFixed(2);
        inspector.querySelector('[data-field="volume"]').value = String(clip.volume);
        inspector.querySelector('[data-field="muted"]').checked = clip.muted;
        clipMeta.innerHTML = `Source: ${clip.sourceDuration.toFixed(2)}s<br>Timeline: ${clip.timelineStart.toFixed(2)}s → ${(clip.timelineStart + clipDuration(clip)).toFixed(2)}s${clip.model ? `<br>Model: ${clip.model}` : ''}`;
    };

    const updateToolbarState = () => {
        root.querySelector('[data-action="undo"]').disabled = !undoStack.length;
        root.querySelector('[data-action="redo"]').disabled = !redoStack.length;
        ['split', 'duplicate', 'delete'].forEach(action => {
            root.querySelector(`[data-action="${action}"]`).disabled = !selectedClip();
        });
        root.querySelector('[data-action="play"]').textContent = isPlaying ? '❚❚' : '▶';
    };

    const splitAtPlayhead = () => {
        const clip = selectedClip() || getClipAtTime(playhead);
        if (!clip) return;
        const local = playhead - clip.timelineStart;
        if (local <= 0.05 || local >= clipDuration(clip) - 0.05) return;
        commit(draft => {
            const index = draft.findIndex(c => c.id === clip.id);
            const original = draft[index];
            const cutSourceTime = original.trimStart + local;
            const left = { ...original, id: uid(), trimEnd: cutSourceTime, label: `${original.label} A` };
            const right = { ...original, id: uid(), trimStart: cutSourceTime, label: `${original.label} B` };
            draft.splice(index, 1, left, right);
            selectedId = right.id;
            return draft;
        });
    };

    const duplicateSelected = () => {
        const clip = selectedClip();
        if (!clip) return;
        commit(draft => {
            const index = draft.findIndex(c => c.id === clip.id);
            const copy = { ...draft[index], id: uid(), label: `${draft[index].label} copy` };
            draft.splice(index + 1, 0, copy);
            selectedId = copy.id;
            return draft;
        });
    };

    const deleteSelected = () => {
        const clip = selectedClip();
        if (!clip) return;
        commit(draft => {
            const index = draft.findIndex(c => c.id === clip.id);
            draft.splice(index, 1);
            selectedId = draft[Math.min(index, draft.length - 1)]?.id || null;
            return draft;
        });
    };

    const tick = (timestamp) => {
        if (!isPlaying) return;
        if (!lastTick) lastTick = timestamp;
        const delta = (timestamp - lastTick) / 1000;
        lastTick = timestamp;
        playhead += delta;
        if (playhead >= totalDuration()) {
            playhead = totalDuration();
            stopPlayback();
        }
        syncPreviewToPlayhead();
        raf = requestAnimationFrame(tick);
    };

    const startPlayback = () => {
        if (!state.length) return;
        if (playhead >= totalDuration()) playhead = 0;
        isPlaying = true;
        lastTick = 0;
        syncPreviewToPlayhead();
        preview.play().catch(() => {});
        updateToolbarState();
        raf = requestAnimationFrame(tick);
    };

    const stopPlayback = () => {
        isPlaying = false;
        preview.pause();
        lastTick = 0;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        updateToolbarState();
    };

    const togglePlayback = () => isPlaying ? stopPlayback() : startPlayback();

    timeline.addEventListener('mousedown', (event) => {
        if (event.target.closest('[data-clip-id]')) return;
        const rect = timeline.getBoundingClientRect();
        playhead = clamp((event.clientX - rect.left) / zoom, 0, totalDuration());
        syncPreviewToPlayhead();
    });

    window.addEventListener('mousemove', (event) => {
        if (!dragState) return;
        const deltaSeconds = (event.clientX - dragState.startX) / zoom;
        const original = dragState.originalClip;

        if (dragState.type === 'trim-left' || dragState.type === 'trim-right') {
            state = deepClone(dragState.originalState);
            const clip = state.find(c => c.id === dragState.clipId);
            if (!clip) return;
            if (dragState.type === 'trim-left') {
                clip.trimStart = clamp(original.trimStart + deltaSeconds, 0, original.trimEnd - 0.05);
            } else {
                clip.trimEnd = clamp(original.trimEnd + deltaSeconds, original.trimStart + 0.05, original.sourceDuration);
            }
            state = packTimeline(state);
            renderTimeline();
            syncPreviewToPlayhead();
            return;
        }

        if (dragState.type === 'reorder') {
            const moving = dragState.originalState.find(c => c.id === dragState.clipId);
            if (!moving) return;
            const desiredCenter = moving.timelineStart + clipDuration(moving) / 2 + deltaSeconds;
            const others = dragState.originalState.filter(c => c.id !== moving.id);
            let insertAt = others.findIndex(c => desiredCenter < c.timelineStart + clipDuration(c) / 2);
            if (insertAt < 0) insertAt = others.length;
            const reordered = [...others];
            reordered.splice(insertAt, 0, moving);
            state = packTimeline(reordered);
            renderTimeline();
            syncPreviewToPlayhead();
        }
    });

    window.addEventListener('mouseup', () => {
        if (!dragState) return;
        const before = dragState.originalState;
        const changed = JSON.stringify(before) !== JSON.stringify(state);
        if (changed) {
            undoStack.push(deepClone(before));
            if (undoStack.length > 100) undoStack.shift();
            redoStack = [];
            onChange(deepClone(state));
        }
        dragState = null;
        updateToolbarState();
    });

    zoomInput.addEventListener('input', () => {
        zoom = Number(zoomInput.value);
        zoomLabel.textContent = `${zoom}px`;
        renderTimeline();
        syncPreviewToPlayhead();
    });

    root.querySelector('[data-action="close"]').onclick = () => {
        stopPlayback();
        onClose(deepClone(state));
        root.remove();
    };
    root.querySelector('[data-action="undo"]').onclick = undo;
    root.querySelector('[data-action="redo"]').onclick = redo;
    root.querySelector('[data-action="play"]').onclick = togglePlayback;
    root.querySelector('[data-action="split"]').onclick = splitAtPlayhead;
    root.querySelector('[data-action="duplicate"]').onclick = duplicateSelected;
    root.querySelector('[data-action="delete"]').onclick = deleteSelected;
    root.querySelector('[data-action="export-json"]').onclick = () => {
        const blob = new Blob([JSON.stringify({ version: 1, clips: state, duration: totalDuration() }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'scenestudio-timeline.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    inspector.querySelector('[data-field="label"]').addEventListener('change', (event) => {
        const value = event.target.value.trim() || 'Untitled clip';
        commit(draft => { const clip = draft.find(c => c.id === selectedId); if (clip) clip.label = value; return draft; });
    });
    inspector.querySelector('[data-field="trimStart"]').addEventListener('change', (event) => {
        const value = Number(event.target.value);
        commit(draft => { const clip = draft.find(c => c.id === selectedId); if (clip) clip.trimStart = clamp(value, 0, clip.trimEnd - 0.05); return draft; });
    });
    inspector.querySelector('[data-field="trimEnd"]').addEventListener('change', (event) => {
        const value = Number(event.target.value);
        commit(draft => { const clip = draft.find(c => c.id === selectedId); if (clip) clip.trimEnd = clamp(value, clip.trimStart + 0.05, clip.sourceDuration); return draft; });
    });
    inspector.querySelector('[data-field="volume"]').addEventListener('change', (event) => {
        const value = Number(event.target.value);
        commit(draft => { const clip = draft.find(c => c.id === selectedId); if (clip) clip.volume = clamp(value, 0, 1); return draft; });
    });
    inspector.querySelector('[data-field="muted"]').addEventListener('change', (event) => {
        const value = event.target.checked;
        commit(draft => { const clip = draft.find(c => c.id === selectedId); if (clip) clip.muted = value; return draft; });
    });

    const keyHandler = (event) => {
        if (!document.body.contains(root)) return;
        const target = event.target;
        const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        const meta = event.metaKey || event.ctrlKey;
        if (meta && event.key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) redo(); else undo();
            return;
        }
        if (isTyping) return;
        if (event.code === 'Space') {
            event.preventDefault();
            togglePlayback();
        } else if (event.key.toLowerCase() === 's') {
            event.preventDefault();
            splitAtPlayhead();
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            deleteSelected();
        }
    };
    window.addEventListener('keydown', keyHandler);

    const cleanupObserver = new MutationObserver(() => {
        if (!document.body.contains(root)) {
            stopPlayback();
            window.removeEventListener('keydown', keyHandler);
            cleanupObserver.disconnect();
        }
    });
    cleanupObserver.observe(document.body, { childList: true, subtree: true });

    renderTimeline();
    syncPreviewToPlayhead();
    updateToolbarState();

    return root;
}

export function timelineClipFromVideo(entry, duration) {
    return normalizeClip({
        id: entry?.id || uid(),
        sourceUrl: entry?.url || entry?.sourceUrl || '',
        sourceDuration: Number(duration || entry?.duration || 5),
        trimStart: 0,
        trimEnd: Number(duration || entry?.duration || 5),
        label: entry?.label || 'Generated clip',
        model: entry?.model || null,
        prompt: entry?.prompt || '',
    });
}
