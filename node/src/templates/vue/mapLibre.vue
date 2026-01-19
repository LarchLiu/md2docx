<!-- TemplateConfig: {"assets":{"scripts":["https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.js","https://cdn.maptiler.com/maptiler-sdk-js/v3.10.2/maptiler-sdk.umd.min.js"],"styles":["https://unpkg.com/maplibre-gl@latest/dist/maplibre-gl.css","https://cdn.maptiler.com/maptiler-sdk-js/v3.10.2/maptiler-sdk.css"]}} -->
<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';

/**
 * @typedef {[number, number]} LngLat
 *
 * @typedef {object} Marker
 * @property {LngLat} lngLat 坐标 [lng, lat]
 * @property {string=} color 可选：标记点颜色（CSS 颜色字符串）
 * @property {string=} popup 可选：标记点弹窗文本
 *
 * @typedef {object} MapLibreTemplateData
 * @property {number=} width 地图宽度（px），默认 900
 * @property {number=} height 地图高度（px），默认 520
 *
 * @property {'maplibre'|'maptiler'=} provider 底图提供方：maplibre（默认）或 maptiler
 * @property {string=} style 样式 URL（Mapbox Style Spec）；例如 MapTiler streets style.json
 *
 * @property {LngLat | {lng:number,lat:number}=} center 地图中心点；支持 [lng,lat] 或 {lng,lat}
 * @property {number=} zoom 缩放级别，默认 1
 * @property {number=} bearing 方位角（度），默认 0
 * @property {number=} pitch 倾斜角（度），默认 0
 * @property {boolean=} showControls 是否显示缩放/旋转控件，默认 true
 *
 * @property {Marker[]=} markers 可选：标记点列表
 *
 * @property {any=} cities 可选：城市/行政区 GeoJSON（FeatureCollection/Feature）
 * @property {string=} citiesUrl 可选：GeoJSON URL（未提供 cities 时会 fetch）
 * @property {string=} cityLabelField 点的标签字段名，默认 name
 * @property {string=} cityPointColor 点颜色，默认 #e11d48
 * @property {number=} cityPointRadius 点半径，默认 6
 * @property {string=} cityFillColor 面填充色（Polygon/MultiPolygon），默认 rgba(14, 165, 233, 0.15)
 * @property {string=} cityLineColor 线/描边色（LineString/Polygon），默认 rgba(2, 132, 199, 0.9)
 * @property {number=} cityLineWidth 线宽，默认 1.5
 *
 * @property {string=} maptilerKey MapTiler API Key（provider=maptiler 时使用）
 * @property {string=} apiKey maptilerKey 别名（兼容字段）
 * @property {string=} maptilerStyle MapTiler 预置样式名（例如 STREETS）；仅在未提供 style 时使用
 */

/** @type {MapLibreTemplateData} */
const cfg = (templateData && typeof templateData === 'object' && !Array.isArray(templateData)) ? templateData : {};

const num = (v, fallback) => {
  const n = (typeof v === 'number') ? v : (typeof v === 'string' ? Number(v) : NaN);
  return Number.isFinite(n) ? n : fallback;
};

const width = num(cfg.width, 900);
const height = num(cfg.height, 520);

const provider =
  (typeof cfg.provider === 'string' && cfg.provider.trim().toLowerCase() === 'maptiler') ? 'maptiler' : 'maplibre';

const styleUrl = (typeof cfg.style === 'string' && cfg.style.trim()) ? cfg.style.trim() : '';

const center = (() => {
  const c = cfg.center;
  if (Array.isArray(c) && c.length >= 2) {
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  if (c && typeof c === 'object') {
    const lng = Number(c.lng);
    const lat = Number(c.lat);
    if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
  }
  return [0, 0];
})();

const zoom = num(cfg.zoom, 1);
const bearing = num(cfg.bearing, 0);
const pitch = num(cfg.pitch, 0);
const showControls = cfg.showControls !== false;

const mapElRef = ref(null);
const err = ref('');

let map = null;

const normalizeMarkers = () => {
  const raw = cfg.markers;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (Array.isArray(m) && m.length >= 2) {
      const lng = Number(m[0]);
      const lat = Number(m[1]);
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        out.push({ lngLat: [lng, lat] });
      }
      continue;
    }
    if (!m || typeof m !== 'object') continue;
    const ll = Array.isArray(m.lngLat) ? m.lngLat : (Array.isArray(m.center) ? m.center : null);
    if (!ll || ll.length < 2) continue;
    const lng = Number(ll[0]);
    const lat = Number(ll[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.push({
      lngLat: [lng, lat],
      color: (typeof m.color === 'string' && m.color.trim()) ? m.color.trim() : '',
      popup: (typeof m.popup === 'string' && m.popup.trim()) ? m.popup.trim() : '',
    });
  }
  return out;
};

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const normalizeCitiesGeoJson = (v) => {
  if (!v) return null;
  if (!isPlainObject(v)) return null;
  const t = String(v.type || '').trim();
  if (!t) return null;
  // Minimal acceptance: FeatureCollection / Feature.
  if (t !== 'FeatureCollection' && t !== 'Feature') return null;
  return v;
};

const anyFilter = (...parts) => ['any', ...parts];
const eq = (a, b) => ['==', a, b];
const geometryType = () => ['geometry-type'];

const addCitiesLayers = async (maplibregl) => {
  const sourceId = 'md2x-cities';

  let geojson = normalizeCitiesGeoJson(cfg.cities);
  const citiesUrl = (typeof cfg.citiesUrl === 'string' && cfg.citiesUrl.trim()) ? cfg.citiesUrl.trim() : '';
  if (!geojson && citiesUrl) {
    try {
      const res = await fetch(citiesUrl);
      if (res.ok) {
        const j = await res.json();
        geojson = normalizeCitiesGeoJson(j);
      }
    } catch {}
  }
  if (!geojson) return;

  try {
    if (typeof map.getSource === 'function' && map.getSource(sourceId)) {
      try { map.removeLayer(sourceId + '-label'); } catch {}
      try { map.removeLayer(sourceId + '-point'); } catch {}
      try { map.removeLayer(sourceId + '-line'); } catch {}
      try { map.removeLayer(sourceId + '-fill'); } catch {}
      try { map.removeSource(sourceId); } catch {}
    }
  } catch {}

  try {
    map.addSource(sourceId, { type: 'geojson', data: geojson });
  } catch (e) {
    return;
  }

  const labelField = (typeof cfg.cityLabelField === 'string' && cfg.cityLabelField.trim()) ? cfg.cityLabelField.trim() : 'name';
  const pointColor = (typeof cfg.cityPointColor === 'string' && cfg.cityPointColor.trim()) ? cfg.cityPointColor.trim() : '#e11d48';
  const pointRadius = num(cfg.cityPointRadius, 6);

  const fillColor = (typeof cfg.cityFillColor === 'string' && cfg.cityFillColor.trim()) ? cfg.cityFillColor.trim() : 'rgba(14, 165, 233, 0.15)';
  const lineColor = (typeof cfg.cityLineColor === 'string' && cfg.cityLineColor.trim()) ? cfg.cityLineColor.trim() : 'rgba(2, 132, 199, 0.9)';
  const lineWidth = num(cfg.cityLineWidth, 1.5);

  const isPoint = eq(geometryType(), 'Point');
  const isPolygon = anyFilter(eq(geometryType(), 'Polygon'), eq(geometryType(), 'MultiPolygon'));
  const isLine = anyFilter(eq(geometryType(), 'LineString'), eq(geometryType(), 'MultiLineString'));

  // Polygons (if provided): fill + outline
  try {
    map.addLayer({
      id: sourceId + '-fill',
      type: 'fill',
      source: sourceId,
      filter: isPolygon,
      paint: {
        'fill-color': fillColor,
      },
    });
  } catch {}
  try {
    map.addLayer({
      id: sourceId + '-line',
      type: 'line',
      source: sourceId,
      filter: anyFilter(isPolygon, isLine),
      paint: {
        'line-color': lineColor,
        'line-width': lineWidth,
      },
    });
  } catch {}

  // Points (cities): circle + label
  try {
    map.addLayer({
      id: sourceId + '-point',
      type: 'circle',
      source: sourceId,
      filter: isPoint,
      paint: {
        'circle-radius': pointRadius,
        'circle-color': pointColor,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
      },
    });
  } catch {}
  try {
    map.addLayer({
      id: sourceId + '-label',
      type: 'symbol',
      source: sourceId,
      filter: isPoint,
      layout: {
        'text-field': ['to-string', ['get', labelField]],
        'text-size': 12,
        'text-offset': [0, 1.25],
        'text-anchor': 'top',
      },
      paint: {
        'text-color': '#111827',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1,
      },
    });
  } catch {}
};

onMounted(() => {
  try {
    const maptilersdk = globalThis.maptilersdk;
    const maplibregl = globalThis.maplibregl;

    const wantMapTiler = provider === 'maptiler';
    const hasMapTiler = !!maptilersdk && typeof maptilersdk.Map === 'function';
    const hasMapLibre = !!maplibregl && typeof maplibregl.Map === 'function';

    const useMapTiler = wantMapTiler && hasMapTiler;
    const engine = useMapTiler ? maptilersdk : (hasMapLibre ? maplibregl : null);

    if (!engine || typeof engine.Map !== 'function') {
      err.value = wantMapTiler
        ? 'MapTiler SDK is not available. Set allowTemplateAssets: true to load TemplateConfig assets.'
        : 'MapLibre is not available. Set allowTemplateAssets: true to load TemplateConfig assets.';
      return;
    }
    if (!mapElRef.value) {
      err.value = 'Map container not found.';
      return;
    }

    if (useMapTiler) {
      const key =
        (typeof cfg.maptilerKey === 'string' && cfg.maptilerKey.trim())
          ? cfg.maptilerKey.trim()
          : ((typeof cfg.apiKey === 'string' && cfg.apiKey.trim()) ? cfg.apiKey.trim() : '');
      if (key) {
        try {
          if (engine.config && typeof engine.config === 'object') engine.config.apiKey = key;
        } catch {}
      }

      const maptilerStyle =
        (typeof cfg.maptilerStyle === 'string' && cfg.maptilerStyle.trim()) ? cfg.maptilerStyle.trim() : '';
      const style =
        styleUrl ||
        (() => {
          try {
            const ms = engine.MapStyle;
            if (ms && maptilerStyle && Object.prototype.hasOwnProperty.call(ms, maptilerStyle)) return ms[maptilerStyle];
          } catch {}
          try { return engine.MapStyle ? engine.MapStyle.STREETS : ''; } catch { return ''; }
        })() ||
        'https://demotiles.maplibre.org/style.json';

      map = new engine.Map({
        container: mapElRef.value,
        apiKey: key || undefined,
        style,
        center,
        zoom,
        bearing,
        pitch,
        preserveDrawingBuffer: true,
      });
    } else {
      map = new engine.Map({
        container: mapElRef.value,
        style: styleUrl || 'https://demotiles.maplibre.org/style.json',
        center,
        zoom,
        bearing,
        pitch,
        preserveDrawingBuffer: true,
      });
    }

    if (showControls && typeof engine.NavigationControl === 'function') {
      try {
        map.addControl(new engine.NavigationControl(), 'top-right');
      } catch {}
    }

    const markers = normalizeMarkers();
    map.once('load', () => {
      for (const m of markers) {
        try {
          const mk = (m.color && typeof engine.Marker === 'function')
            ? new engine.Marker({ color: m.color })
            : new engine.Marker();
          mk.setLngLat(m.lngLat);
          if (m.popup && typeof engine.Popup === 'function') {
            mk.setPopup(new engine.Popup({ offset: 16 }).setText(m.popup));
          }
          mk.addTo(map);
        } catch {}
      }
      try { addCitiesLayers(engine); } catch {}
      try { map.resize(); } catch {}
    });
  } catch (e) {
    err.value = (e && e.message) ? e.message : String(e);
  }
});

onBeforeUnmount(() => {
  try {
    if (map) map.remove();
  } catch {}
  map = null;
});
</script>

<template>
  <div class="maplibre-wrap" :style="{ width: width + 'px', height: height + 'px' }">
    <div ref="mapElRef" class="maplibre-map" />
    <div v-if="err" class="maplibre-error">{{ err }}</div>
  </div>
</template>

<style scoped>
.maplibre-wrap {
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 10px;
  background: #f6f7f8;
}

.maplibre-map {
  position: absolute;
  inset: 0;
}

.maplibre-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 12px;
  color: #b00020;
  text-align: center;
  background: rgba(255, 255, 255, 0.92);
}
</style>
