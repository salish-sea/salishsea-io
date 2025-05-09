import {createContext} from '@lit/context';
import type OpenLayersMap from "ol/Map.js";

const mapContext = createContext<OpenLayersMap | undefined>(Symbol('map'));
export default mapContext;
