
import { localize } from '../../../../nls.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { language } from '../../../../base/common/platform.js';

const HasSpeechProvider = ( new RawContextKey("hasSpeechProvider", false, {
    type: "boolean",
    description: ( localize(14268, "A speech provider is registered to the speech service."))
}));
const SpeechToTextInProgress = ( new RawContextKey("speechToTextInProgress", false, {
    type: "boolean",
    description: ( localize(14269, "A speech-to-text session is in progress."))
}));
const TextToSpeechInProgress = ( new RawContextKey("textToSpeechInProgress", false, {
    type: "boolean",
    description: ( localize(14270, "A text-to-speech session is in progress."))
}));
var SpeechToTextStatus;
(function(SpeechToTextStatus) {
    SpeechToTextStatus[SpeechToTextStatus["Started"] = 1] = "Started";
    SpeechToTextStatus[SpeechToTextStatus["Recognizing"] = 2] = "Recognizing";
    SpeechToTextStatus[SpeechToTextStatus["Recognized"] = 3] = "Recognized";
    SpeechToTextStatus[SpeechToTextStatus["Stopped"] = 4] = "Stopped";
    SpeechToTextStatus[SpeechToTextStatus["Error"] = 5] = "Error";
})(SpeechToTextStatus || (SpeechToTextStatus = {}));
var TextToSpeechStatus;
(function(TextToSpeechStatus) {
    TextToSpeechStatus[TextToSpeechStatus["Started"] = 1] = "Started";
    TextToSpeechStatus[TextToSpeechStatus["Stopped"] = 2] = "Stopped";
    TextToSpeechStatus[TextToSpeechStatus["Error"] = 3] = "Error";
})(TextToSpeechStatus || (TextToSpeechStatus = {}));
var KeywordRecognitionStatus;
(function(KeywordRecognitionStatus) {
    KeywordRecognitionStatus[KeywordRecognitionStatus["Recognized"] = 1] = "Recognized";
    KeywordRecognitionStatus[KeywordRecognitionStatus["Stopped"] = 2] = "Stopped";
    KeywordRecognitionStatus[KeywordRecognitionStatus["Canceled"] = 3] = "Canceled";
})(KeywordRecognitionStatus || (KeywordRecognitionStatus = {}));
var AccessibilityVoiceSettingId;
(function(AccessibilityVoiceSettingId) {
    AccessibilityVoiceSettingId["SpeechTimeout"] = "accessibility.voice.speechTimeout";
    AccessibilityVoiceSettingId["AutoSynthesize"] = "accessibility.voice.autoSynthesize";
    AccessibilityVoiceSettingId["SpeechLanguage"] = "accessibility.voice.speechLanguage";
    AccessibilityVoiceSettingId["IgnoreCodeBlocks"] = "accessibility.voice.ignoreCodeBlocks";
})(AccessibilityVoiceSettingId || (AccessibilityVoiceSettingId = {}));
const SPEECH_LANGUAGE_CONFIG = AccessibilityVoiceSettingId.SpeechLanguage;
const SPEECH_LANGUAGES = {
    ["da-DK"]: {
        name: ( localize(14271, "Danish (Denmark)"))
    },
    ["de-DE"]: {
        name: ( localize(14272, "German (Germany)"))
    },
    ["en-AU"]: {
        name: ( localize(14273, "English (Australia)"))
    },
    ["en-CA"]: {
        name: ( localize(14274, "English (Canada)"))
    },
    ["en-GB"]: {
        name: ( localize(14275, "English (United Kingdom)"))
    },
    ["en-IE"]: {
        name: ( localize(14276, "English (Ireland)"))
    },
    ["en-IN"]: {
        name: ( localize(14277, "English (India)"))
    },
    ["en-NZ"]: {
        name: ( localize(14278, "English (New Zealand)"))
    },
    ["en-US"]: {
        name: ( localize(14279, "English (United States)"))
    },
    ["es-ES"]: {
        name: ( localize(14280, "Spanish (Spain)"))
    },
    ["es-MX"]: {
        name: ( localize(14281, "Spanish (Mexico)"))
    },
    ["fr-CA"]: {
        name: ( localize(14282, "French (Canada)"))
    },
    ["fr-FR"]: {
        name: ( localize(14283, "French (France)"))
    },
    ["hi-IN"]: {
        name: ( localize(14284, "Hindi (India)"))
    },
    ["it-IT"]: {
        name: ( localize(14285, "Italian (Italy)"))
    },
    ["ja-JP"]: {
        name: ( localize(14286, "Japanese (Japan)"))
    },
    ["ko-KR"]: {
        name: ( localize(14287, "Korean (South Korea)"))
    },
    ["nl-NL"]: {
        name: ( localize(14288, "Dutch (Netherlands)"))
    },
    ["pt-PT"]: {
        name: ( localize(14289, "Portuguese (Portugal)"))
    },
    ["pt-BR"]: {
        name: ( localize(14290, "Portuguese (Brazil)"))
    },
    ["ru-RU"]: {
        name: ( localize(14291, "Russian (Russia)"))
    },
    ["sv-SE"]: {
        name: ( localize(14292, "Swedish (Sweden)"))
    },
    ["tr-TR"]: {
        name: ( localize(14293, "Turkish (Türkiye)"))
    },
    ["zh-CN"]: {
        name: ( localize(14294, "Chinese (Simplified, China)"))
    },
    ["zh-HK"]: {
        name: ( localize(14295, "Chinese (Traditional, Hong Kong)"))
    },
    ["zh-TW"]: {
        name: ( localize(14296, "Chinese (Traditional, Taiwan)"))
    }
};
function speechLanguageConfigToLanguage(config, lang = language) {
    if (typeof config === "string") {
        if (config === "auto") {
            if (lang !== "en") {
                const langParts = lang.split("-");
                return speechLanguageConfigToLanguage(`${langParts[0]}-${(langParts[1] ?? langParts[0]).toUpperCase()}`);
            }
        } else {
            if (SPEECH_LANGUAGES[config]) {
                return config;
            }
        }
    }
    return "en-US";
}

export { AccessibilityVoiceSettingId, HasSpeechProvider, KeywordRecognitionStatus, SPEECH_LANGUAGES, SPEECH_LANGUAGE_CONFIG, SpeechToTextInProgress, SpeechToTextStatus, TextToSpeechInProgress, TextToSpeechStatus, speechLanguageConfigToLanguage };
