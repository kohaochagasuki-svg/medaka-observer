'use strict';
importScripts('analysis-core.js');
let engine;
self.onmessage = ({ data }) => {
  try {
    let result = null;
    if (data.type === 'init') engine = new MedakaAnalysis.Engine(data.config);
    else if (!engine) throw new Error('解析エンジンが初期化されていません。');
    else if (data.type === 'background') engine.detector.addBackground(MedakaAnalysis.grayscale(new Uint8ClampedArray(data.rgba), engine.c.width, engine.c.height));
    else if (data.type === 'ready') engine.detector.finishBackground();
    else if (data.type === 'frame') result = engine.process(MedakaAnalysis.grayscale(new Uint8ClampedArray(data.rgba), engine.c.width, engine.c.height), data.time);
    else throw new Error('不明な解析要求です。');
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
