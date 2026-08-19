import {
    getCharacters,
    saveCharacter,
    removeCharacter,
    setActiveCharacter,
    getActiveCharacterId,
    clearActiveCharacter,
} from '../lib/characterLibrary.js';
import { createUploadPicker } from './UploadPicker.js';
import { muapi } from '../lib/muapi.js';

const esc = (value) => String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[char]));

export function CharacterLock({
    onSelect = () => {},
    onClose = () => {},
    maxReferences = 9,
} = {}) {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-[320] bg-black/80 backdrop-blur-xl flex items-center justify-center p-3 md:p-8';

    let characters = getCharacters();
    let activeId = getActiveCharacterId();
    let editingId = null;
    let references = [];

    root.innerHTML = `
        <div class="w-full max-w-6xl h-[92vh] bg-[#0b0b0b] border border-white/10 rounded-[28px] shadow-3xl overflow-hidden grid grid-cols-1 md:grid-cols-[320px_1fr]">
            <aside class="border-r border-white/10 bg-black/30 min-h-0 flex flex-col">
                <div class="p-4 border-b border-white/10 flex items-center justify-between">
                    <div>
                        <div class="text-sm font-black text-white">Character Lock</div>
                        <div class="text-[10px] text-white/35">Reusable identity profiles</div>
                    </div>
                    <button data-action="close" class="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white">×</button>
                </div>
                <div class="p-3">
                    <button data-action="new" class="w-full py-2.5 rounded-xl bg-primary text-black text-xs font-black">+ New Character</button>
                </div>
                <div data-role="character-list" class="flex-1 overflow-y-auto custom-scrollbar p-3 pt-0 space-y-2"></div>
            </aside>

            <main class="min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6">
                <div class="max-w-3xl mx-auto space-y-6">
                    <div>
                        <div class="text-2xl font-black tracking-tight text-white">Lock a character identity</div>
                        <p class="text-xs text-white/40 mt-1 max-w-2xl">Save a person's reference images, appearance, wardrobe, voice and model preferences so SceneStudio can reuse the same identity across UGC, cinematic scenes and future generations.</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label class="space-y-1.5">
                            <span class="text-[10px] uppercase tracking-wider text-white/45">Character name</span>
                            <input data-field="name" class="field" placeholder="e.g. Michael" />
                        </label>
                        <label class="space-y-1.5">
                            <span class="text-[10px] uppercase tracking-wider text-white/45">Voice ID</span>
                            <input data-field="voiceId" class="field" placeholder="Optional voice model / voice ID" />
                        </label>
                    </div>

                    <label class="space-y-1.5 block">
                        <span class="text-[10px] uppercase tracking-wider text-white/45">Short description</span>
                        <textarea data-field="description" class="field min-h-20 resize-y" placeholder="Who is this character?"></textarea>
                    </label>

                    <label class="space-y-1.5 block">
                        <span class="text-[10px] uppercase tracking-wider text-white/45">Appearance lock</span>
                        <textarea data-field="appearance" class="field min-h-28 resize-y" placeholder="Face shape, skin tone, hair, eyes, age appearance, body proportions, distinctive features..."></textarea>
                    </label>

                    <label class="space-y-1.5 block">
                        <span class="text-[10px] uppercase tracking-wider text-white/45">Default wardrobe</span>
                        <textarea data-field="wardrobe" class="field min-h-20 resize-y" placeholder="Optional clothing/look to keep consistent"></textarea>
                    </label>

                    <div class="space-y-3">
                        <div class="flex items-end justify-between gap-4">
                            <div>
                                <div class="text-[10px] uppercase tracking-wider text-white/45">Reference images</div>
                                <div class="text-[10px] text-white/30 mt-1">Use several clear angles for stronger consistency. Maximum ${maxReferences} for this profile.</div>
                            </div>
                            <div data-role="ref-count" class="text-[10px] font-mono text-primary">0 / ${maxReferences}</div>
                        </div>
                        <div class="flex items-start gap-3 flex-wrap">
                            <div data-role="reference-grid" class="contents"></div>
                            <div data-role="picker-slot"></div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <label class="space-y-1.5">
                            <span class="text-[10px] uppercase tracking-wider text-white/45">Preferred provider</span>
                            <input data-field="preferredProvider" class="field" placeholder="auto / kie / byteplus" />
                        </label>
                        <label class="space-y-1.5">
                            <span class="text-[10px] uppercase tracking-wider text-white/45">Image model</span>
                            <input data-field="preferredImageModel" class="field" placeholder="Optional" />
                        </label>
                        <label class="space-y-1.5">
                            <span class="text-[10px] uppercase tracking-wider text-white/45">Video model</span>
                            <input data-field="preferredVideoModel" class="field" placeholder="Optional" />
                        </label>
                    </div>

                    <label class="space-y-1.5 block">
                        <span class="text-[10px] uppercase tracking-wider text-white/45">Identity prompt prefix</span>
                        <textarea data-field="promptPrefix" class="field min-h-20 resize-y" placeholder="Optional extra identity instruction that should be prepended to generations"></textarea>
                    </label>

                    <label class="space-y-1.5 block">
                        <span class="text-[10px] uppercase tracking-wider text-white/45">Negative identity prompt</span>
                        <textarea data-field="negativePrompt" class="field min-h-20 resize-y" placeholder="Optional: traits or identity drift to avoid"></textarea>
                    </label>

                    <div class="flex flex-wrap gap-3 pt-2 border-t border-white/10">
                        <button data-action="save" class="px-5 py-2.5 rounded-xl bg-primary text-black text-xs font-black">Save Character</button>
                        <button data-action="use" class="px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-bold text-white">Save & Use Character</button>
                        <button data-action="clear" class="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/60">Clear form</button>
                        <button data-action="delete" class="hidden ml-auto px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/15 border border-red-500/20 text-xs font-bold text-red-300">Delete</button>
                    </div>
                </div>
            </main>
        </div>
    `;

    root.querySelectorAll('.field').forEach(field => {
        field.className += ' w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-primary/50 placeholder:text-white/20';
    });

    const list = root.querySelector('[data-role="character-list"]');
    const grid = root.querySelector('[data-role="reference-grid"]');
    const refCount = root.querySelector('[data-role="ref-count"]');
    const pickerSlot = root.querySelector('[data-role="picker-slot"]');
    const deleteBtn = root.querySelector('[data-action="delete"]');

    const getValue = (name) => root.querySelector(`[data-field="${name}"]`)?.value || '';
    const setValue = (name, value) => {
        const field = root.querySelector(`[data-field="${name}"]`);
        if (field) field.value = value || '';
    };

    const picker = createUploadPicker({
        anchorContainer: root,
        onSelect: ({ url, thumbnail, name, id }) => {
            if (!url || references.length >= maxReferences) return;
            if (!references.some(ref => ref.url === url)) {
                references.push({ id: id || `ref-${Date.now()}`, url, thumbnail: thumbnail || url, label: name || `Reference ${references.length + 1}` });
            }
            picker.reset();
            renderReferences();
        },
        onClear: () => {},
        uploadFn: (file) => muapi.uploadFile(file),
        requireApiKey: () => true,
    });
    picker.trigger.title = 'Add character reference';
    pickerSlot.appendChild(picker.trigger);
    root.appendChild(picker.panel);

    const resetForm = () => {
        editingId = null;
        references = [];
        ['name', 'voiceId', 'description', 'appearance', 'wardrobe', 'preferredProvider', 'preferredImageModel', 'preferredVideoModel', 'promptPrefix', 'negativePrompt'].forEach(key => setValue(key, ''));
        picker.reset();
        deleteBtn.classList.add('hidden');
        renderReferences();
        renderList();
    };

    const readForm = () => ({
        id: editingId || undefined,
        name: getValue('name'),
        voiceId: getValue('voiceId'),
        description: getValue('description'),
        appearance: getValue('appearance'),
        wardrobe: getValue('wardrobe'),
        preferredProvider: getValue('preferredProvider'),
        preferredImageModel: getValue('preferredImageModel'),
        preferredVideoModel: getValue('preferredVideoModel'),
        promptPrefix: getValue('promptPrefix'),
        negativePrompt: getValue('negativePrompt'),
        referenceImages: references,
    });

    const validate = () => {
        if (!getValue('name').trim()) {
            alert('Give this character a name.');
            return false;
        }
        if (!references.length) {
            alert('Add at least one clear reference image for Character Lock.');
            return false;
        }
        return true;
    };

    const save = () => {
        if (!validate()) return null;
        const saved = saveCharacter(readForm());
        editingId = saved.id;
        characters = getCharacters();
        deleteBtn.classList.remove('hidden');
        renderList();
        return saved;
    };

    const loadCharacter = (character) => {
        editingId = character.id;
        references = [...(character.referenceImages || [])];
        setValue('name', character.name);
        setValue('voiceId', character.voiceId);
        setValue('description', character.description);
        setValue('appearance', character.appearance);
        setValue('wardrobe', character.wardrobe);
        setValue('preferredProvider', character.preferredProvider);
        setValue('preferredImageModel', character.preferredImageModel);
        setValue('preferredVideoModel', character.preferredVideoModel);
        setValue('promptPrefix', character.promptPrefix);
        setValue('negativePrompt', character.negativePrompt);
        deleteBtn.classList.remove('hidden');
        renderReferences();
        renderList();
    };

    const renderReferences = () => {
        grid.innerHTML = '';
        references.forEach((ref, index) => {
            const card = document.createElement('div');
            card.className = 'relative w-20 h-20 rounded-2xl overflow-hidden border border-white/10 group bg-white/5';
            card.innerHTML = `
                <img src="${esc(ref.thumbnail || ref.url)}" class="w-full h-full object-cover" alt="Character reference ${index + 1}" />
                <div class="absolute left-1 top-1 w-5 h-5 rounded-lg bg-black/70 backdrop-blur flex items-center justify-center text-[9px] font-black text-primary">${index + 1}</div>
                <button data-remove="${index}" class="absolute right-1 top-1 w-5 h-5 rounded-lg bg-black/70 hover:bg-red-500 text-white text-[10px] opacity-0 group-hover:opacity-100">×</button>
            `;
            card.querySelector('button').onclick = () => {
                references.splice(index, 1);
                renderReferences();
            };
            grid.appendChild(card);
        });
        refCount.textContent = `${references.length} / ${maxReferences}`;
        picker.trigger.classList.toggle('hidden', references.length >= maxReferences);
    };

    const renderList = () => {
        list.innerHTML = '';
        characters = getCharacters();
        if (!characters.length) {
            list.innerHTML = '<div class="rounded-xl border border-dashed border-white/10 p-4 text-[11px] text-white/30 text-center">No saved characters yet.</div>';
            return;
        }
        characters.forEach(character => {
            const item = document.createElement('button');
            const active = activeId === character.id;
            const editing = editingId === character.id;
            item.className = `w-full text-left rounded-2xl border p-2.5 flex items-center gap-3 transition-colors ${editing ? 'border-primary/60 bg-primary/10' : active ? 'border-white/20 bg-white/[0.06]' : 'border-white/10 hover:bg-white/[0.04]'}`;
            const thumb = character.referenceImages?.[0]?.thumbnail || character.referenceImages?.[0]?.url || '';
            item.innerHTML = `
                <div class="w-11 h-11 rounded-xl overflow-hidden bg-white/5 shrink-0">${thumb ? `<img src="${esc(thumb)}" class="w-full h-full object-cover" />` : ''}</div>
                <div class="min-w-0 flex-1">
                    <div class="text-xs font-black text-white truncate">${esc(character.name)}</div>
                    <div class="text-[9px] text-white/35 truncate">${character.referenceImages?.length || 0} reference${character.referenceImages?.length === 1 ? '' : 's'}${active ? ' · ACTIVE' : ''}</div>
                </div>
                ${active ? '<div class="w-2 h-2 rounded-full bg-primary shadow-glow"></div>' : ''}
            `;
            item.onclick = () => loadCharacter(character);
            list.appendChild(item);
        });
    };

    root.querySelector('[data-action="close"]').onclick = () => {
        onClose();
        root.remove();
    };
    root.querySelector('[data-action="new"]').onclick = resetForm;
    root.querySelector('[data-action="clear"]').onclick = resetForm;
    root.querySelector('[data-action="save"]').onclick = save;
    root.querySelector('[data-action="use"]').onclick = () => {
        const saved = save();
        if (!saved) return;
        setActiveCharacter(saved.id);
        activeId = saved.id;
        renderList();
        onSelect(saved);
    };
    deleteBtn.onclick = () => {
        if (!editingId) return;
        const character = characters.find(item => item.id === editingId);
        if (!confirm(`Delete ${character?.name || 'this character'}?`)) return;
        removeCharacter(editingId);
        if (activeId === editingId) {
            activeId = null;
            clearActiveCharacter();
        }
        resetForm();
    };

    renderList();
    renderReferences();
    const active = characters.find(character => character.id === activeId);
    if (active) loadCharacter(active);

    return root;
}
