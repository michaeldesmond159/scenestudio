const STORAGE_KEY = 'scenestudio_characters';
const ACTIVE_KEY = 'scenestudio_active_character';
const MAX_CHARACTERS = 50;

const uid = () => (globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `character-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const cleanText = (value) => String(value || '').trim();

export function normalizeCharacter(input = {}) {
    const refs = Array.isArray(input.referenceImages) ? input.referenceImages : [];
    return {
        id: input.id || uid(),
        name: cleanText(input.name) || 'Untitled Character',
        description: cleanText(input.description),
        appearance: cleanText(input.appearance),
        wardrobe: cleanText(input.wardrobe),
        voiceId: cleanText(input.voiceId) || null,
        voiceName: cleanText(input.voiceName) || null,
        referenceImages: refs
            .filter(Boolean)
            .slice(0, 14)
            .map((ref, index) => typeof ref === 'string'
                ? { id: `ref-${index}`, url: ref, thumbnail: ref, label: `Reference ${index + 1}` }
                : {
                    id: ref.id || `ref-${index}`,
                    url: ref.url || ref.uploadedUrl || '',
                    thumbnail: ref.thumbnail || ref.url || ref.uploadedUrl || '',
                    label: cleanText(ref.label) || `Reference ${index + 1}`,
                })
            .filter(ref => ref.url),
        preferredProvider: cleanText(input.preferredProvider) || null,
        preferredImageModel: cleanText(input.preferredImageModel) || null,
        preferredVideoModel: cleanText(input.preferredVideoModel) || null,
        promptPrefix: cleanText(input.promptPrefix),
        negativePrompt: cleanText(input.negativePrompt),
        createdAt: input.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}

export function getCharacters() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.map(normalizeCharacter) : [];
    } catch {
        return [];
    }
}

export function getCharacter(id) {
    return getCharacters().find(character => character.id === id) || null;
}

export function saveCharacter(input) {
    const character = normalizeCharacter(input);
    const characters = getCharacters();
    const existingIndex = characters.findIndex(item => item.id === character.id);
    if (existingIndex >= 0) {
        character.createdAt = characters[existingIndex].createdAt || character.createdAt;
        characters[existingIndex] = character;
    } else {
        characters.unshift(character);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters.slice(0, MAX_CHARACTERS)));
    return character;
}

export function removeCharacter(id) {
    const characters = getCharacters().filter(character => character.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(characters));
    if (getActiveCharacterId() === id) clearActiveCharacter();
}

export function setActiveCharacter(id) {
    if (!id) return clearActiveCharacter();
    localStorage.setItem(ACTIVE_KEY, id);
}

export function getActiveCharacterId() {
    return localStorage.getItem(ACTIVE_KEY) || null;
}

export function getActiveCharacter() {
    const id = getActiveCharacterId();
    return id ? getCharacter(id) : null;
}

export function clearActiveCharacter() {
    localStorage.removeItem(ACTIVE_KEY);
}

export function buildCharacterGenerationContext(character, { maxReferences = 9 } = {}) {
    if (!character) return null;
    const normalized = normalizeCharacter(character);
    const identity = [
        normalized.description,
        normalized.appearance,
        normalized.wardrobe ? `Wardrobe: ${normalized.wardrobe}` : '',
        normalized.promptPrefix,
    ].filter(Boolean).join('. ');

    return {
        characterId: normalized.id,
        characterName: normalized.name,
        identityPrompt: identity,
        negativePrompt: normalized.negativePrompt || '',
        referenceImageUrls: normalized.referenceImages.slice(0, Math.max(1, maxReferences)).map(ref => ref.url),
        voiceId: normalized.voiceId,
        preferredProvider: normalized.preferredProvider,
        preferredImageModel: normalized.preferredImageModel,
        preferredVideoModel: normalized.preferredVideoModel,
    };
}

export function applyCharacterToPrompt(prompt, character) {
    const context = buildCharacterGenerationContext(character);
    if (!context?.identityPrompt) return String(prompt || '').trim();
    const userPrompt = String(prompt || '').trim();
    return `${context.identityPrompt}. Maintain the exact same character identity, facial features, skin tone, hair, age appearance, body proportions, and distinguishing traits across the full shot.${userPrompt ? ` Scene direction: ${userPrompt}` : ''}`;
}
