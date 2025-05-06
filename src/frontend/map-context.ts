import {createContext} from '@lit/context';
import type OpenLayersMap from "ol/Map.js";

const mapContext = createContext<OpenLayersMap>(Symbol('map'));
export default mapContext;
