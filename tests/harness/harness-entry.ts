// 静态导入顺序决定模块求值顺序：假 API 先装好，再启动真正的渲染入口
import './mock-boot'
import '../../src/renderer/src/main'
