import { muapi } from './muapi.js';
import { applyCharacterToPrompt, buildCharacterGenerationContext, getActiveCharacter } from './characterLibrary.js';

const PATCH_FLAG = '__SCENESTUDIO_CHARACTER_AWARE_GENERATION__';

const uniqueUrls = (values = []) => [...new Set(values.filter(Boolean))];

function getContext() {
    const character = getActiveCharacter();
    if (!character) return { character: null, context: null };
    return {
        character,
        context: buildCharacterGenerationContext(character, { maxReferences: 9 }),
    };
}

function withIdentityPrompt(params = {}) {
    const { character, context } = getContext();
    if (!character || !context) return { params: { ...params }, context: null };

    return {
        params: {
            ...params,
            prompt: applyCharacterToPrompt(params.prompt || '', character),
            character_id: context.characterId,
            character_name: context.characterName,
        },
        context,
    };
}

/**
 * Patches the existing MuAPI client instance so every SceneStudio generation
 * can consume the currently active Character Lock profile without requiring
 * each studio to duplicate identity logic.
 *
 * Safety rules:
 * - T2V/T2I only receive identity prompt text; we do NOT silently change the
 *   generation mode by injecting an image into a text-only request.
 * - I2V/I2I merge explicit user references with Character Lock references.
 * - Explicit user-provided references stay first in the list.
 * - Unknown provider fields are not forwarded; character_id/name are only
 *   local metadata and are stripped before the original MuAPI method runs.
 */
export function installCharacterAwareGeneration() {
    if (globalThis[PATCH_FLAG]) return;
    globalThis[PATCH_FLAG] = true;

    const originalGenerateVideo = muapi.generateVideo.bind(muapi);
    const originalGenerateI2V = muapi.generateI2V.bind(muapi);
    const originalGenerateImage = muapi.generateImage.bind(muapi);
    const originalGenerateI2I = muapi.generateI2I.bind(muapi);
    const originalProcessV2V = muapi.processV2V.bind(muapi);

    muapi.generateVideo = async (input = {}) => {
        const { params, context } = withIdentityPrompt(input);
        delete params.character_id;
        delete params.character_name;
        if (context) console.log('[CharacterLock] Applying identity to T2V:', context.characterName);
        return originalGenerateVideo(params);
    };

    muapi.generateI2V = async (input = {}) => {
        const { params, context } = withIdentityPrompt(input);
        delete params.character_id;
        delete params.character_name;

        if (context?.referenceImageUrls?.length) {
            const explicit = params.images_list?.length
                ? params.images_list
                : (params.image_url ? [params.image_url] : []);
            params.images_list = uniqueUrls([...explicit, ...context.referenceImageUrls]).slice(0, 9);
            // Leave image_url in place for compatibility; generateI2V prioritizes images_list.
            console.log('[CharacterLock] Applying identity references to I2V:', context.characterName, params.images_list.length);
        }
        return originalGenerateI2V(params);
    };

    muapi.generateImage = async (input = {}) => {
        const { params, context } = withIdentityPrompt(input);
        delete params.character_id;
        delete params.character_name;
        if (context) console.log('[CharacterLock] Applying identity to T2I:', context.characterName);
        return originalGenerateImage(params);
    };

    muapi.generateI2I = async (input = {}) => {
        const { params, context } = withIdentityPrompt(input);
        delete params.character_id;
        delete params.character_name;

        if (context?.referenceImageUrls?.length) {
            const explicit = params.images_list?.length
                ? params.images_list
                : (params.image_url ? [params.image_url] : []);
            params.images_list = uniqueUrls([...explicit, ...context.referenceImageUrls]).slice(0, 14);
            console.log('[CharacterLock] Applying identity references to I2I:', context.characterName, params.images_list.length);
        }
        return originalGenerateI2I(params);
    };

    muapi.processV2V = async (input = {}) => {
        const { params, context } = withIdentityPrompt(input);
        delete params.character_id;
        delete params.character_name;
        if (context?.referenceImageUrls?.length && !params.image_url) {
            params.image_url = context.referenceImageUrls[0];
        }
        if (context) console.log('[CharacterLock] Applying identity to V2V:', context.characterName);
        return originalProcessV2V(params);
    };
}

installCharacterAwareGeneration();
