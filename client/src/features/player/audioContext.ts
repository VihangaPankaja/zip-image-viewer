import { createContext, useContext } from "react";
import type { AudioPlayback } from "./useAudioPlayback";

export const AudioContext = createContext<AudioPlayback | null>(null);
export const useAudioPlayer = () => useContext(AudioContext);
