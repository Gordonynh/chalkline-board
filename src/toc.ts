export interface TocSection {
  title: string
  page: number
}

export interface TocChapter {
  title: string
  page: number
  endPage: number
  sections: TocSection[]
}

export const textbookToc: TocChapter[] = [
  {
    title: '前言与导学',
    page: 3,
    endPage: 9,
    sections: [],
  },
  {
    title: '第一章 集合、常用逻辑用语、不等式',
    page: 10,
    endPage: 27,
    sections: [
      { title: '§1.1 集合', page: 10 },
      { title: '§1.2 常用逻辑用语', page: 14 },
      { title: '§1.3 等式性质与不等式性质', page: 16 },
      { title: '§1.4 基本不等式', page: 18 },
      { title: '§1.5 基本不等式的综合应用', page: 20 },
      { title: '§1.6 一元二次方程、不等式', page: 22 },
    ],
  },
  {
    title: '第二章 函数',
    page: 28,
    endPage: 57,
    sections: [
      { title: '§2.1 函数的概念及其表示', page: 28 },
      { title: '§2.2 函数的单调性与最值', page: 30 },
      { title: '微拓展 求函数的值域(最值)的常用方法', page: 32 },
      { title: '§2.3 函数的奇偶性', page: 34 },
      { title: '§2.4 函数的周期性和对称性', page: 36 },
      { title: '§2.5 二次函数与幂函数', page: 38 },
      { title: '§2.6 指数与指数函数', page: 42 },
      { title: '§2.7 对数与对数函数', page: 44 },
      { title: '§2.8 指、对、幂的大小比较[微重点]', page: 48 },
      { title: '§2.9 函数的图象', page: 48 },
      { title: '§2.10 函数的零点与方程的解', page: 52 },
      { title: '§2.11 函数与方程的综合应用[微重点]', page: 54 },
      { title: '§2.12 函数模型的应用', page: 56 },
    ],
  },
  {
    title: '第三章 一元函数的导数及其应用',
    page: 58,
    endPage: 93,
    sections: [
      { title: '§3.1 导数的概念及其意义、导数的运算', page: 58 },
      { title: '微拓展 洛必达法则', page: 60 },
      { title: '§3.2 导数与函数的单调性', page: 62 },
      { title: '§3.3 导数与函数的极值、最值', page: 64 },
      { title: '§3.4 三次函数的图象与性质', page: 66 },
      { title: '微拓展 泰勒展开式', page: 70 },
      { title: '进阶篇 不等式的证明方法', page: 72 },
      { title: '进阶篇 不等式恒(能)成立问题', page: 82 },
      { title: '进阶篇 导数中的零点问题', page: 90 },
    ],
  },
  {
    title: '第四章 三角函数与解三角形',
    page: 94,
    endPage: 115,
    sections: [
      { title: '§4.1 三角函数基本公式', page: 94 },
      { title: '§4.2 三角恒等变换', page: 98 },
      { title: '§4.3 三角函数的图象与性质', page: 100 },
      { title: '§4.4 函数y=Asin(ωx+φ)', page: 104 },
      { title: '§4.5 三角函数中有关ω的范围问题[微重点]', page: 106 },
      { title: '§4.6 正弦定理、余弦定理', page: 108 },
      { title: '§4.7 解三角形中的最值与范围问题[微重点]', page: 110 },
      { title: '§4.8 解三角形应用举例', page: 112 },
    ],
  },
  {
    title: '第五章 平面向量与复数',
    page: 116,
    endPage: 129,
    sections: [
      { title: '§5.1 平面向量的概念及线性运算', page: 116 },
      { title: '§5.2 平面向量基本定理及坐标表示', page: 118 },
      { title: '微拓展 极化恒等式', page: 122 },
      { title: '§5.4 平面向量中的综合问题[微重点]', page: 124 },
      { title: '§5.5 复数', page: 126 },
    ],
  },
  {
    title: '第六章 数列',
    page: 130,
    endPage: 149,
    sections: [
      { title: '§6.1 数列的概念', page: 130 },
      { title: '§6.2 等差数列', page: 134 },
      { title: '§6.3 等比数列', page: 136 },
      { title: '§6.4 数列中的构造问题[微重点]', page: 140 },
      { title: '§6.5 数列求和(一)', page: 142 },
      { title: '§6.6 数列求和(二)', page: 146 },
    ],
  },
  {
    title: '第七章 立体几何与空间向量',
    page: 150,
    endPage: 179,
    sections: [
      { title: '§7.1 基本立体图形、简单几何体的表面积与体积', page: 150 },
      { title: '§7.2 球的切、接问题[微重点]', page: 152 },
      { title: '§7.3 空间点、直线、平面之间的位置关系', page: 154 },
      { title: '§7.4 空间直线、平面的平行', page: 158 },
      { title: '§7.5 空间直线、平面的垂直', page: 162 },
      { title: '§7.6 空间向量的概念与运算', page: 166 },
      { title: '§7.7 向量法求空间角', page: 170 },
      { title: '微拓展 利用法向量的方向判断二面角', page: 172 },
      { title: '§7.8 空间距离及立体几何中的探索性问题', page: 174 },
      { title: '§7.9 立体几何中的截面、交线问题[微重点]', page: 176 },
      { title: '§7.10 立体几何中的动态、轨迹问题[微重点]', page: 178 },
    ],
  },
  {
    title: '第八章 直线和圆、圆锥曲线',
    page: 180,
    endPage: 217,
    sections: [
      { title: '§8.1 直线的方程', page: 180 },
      { title: '§8.2 两条直线的位置关系', page: 182 },
      { title: '§8.3 圆的方程', page: 184 },
      { title: '§8.4 直线与圆、圆与圆的位置关系', page: 188 },
      { title: '§8.5 椭圆', page: 190 },
      { title: '微拓展 圆锥曲线的第二定义', page: 194 },
      { title: '§8.7 离心率的范围问题[微重点]', page: 196 },
      { title: '§8.8 抛物线', page: 198 },
      { title: '§8.9 直线与圆锥曲线的位置关系', page: 200 },
      { title: '微拓展 圆锥曲线弦长的万能公式(硬解定理)', page: 202 },
      { title: '进阶篇 圆锥曲线中的综合问题', page: 204 },
    ],
  },
  {
    title: '第九章 统计与成对数据的统计分析',
    page: 218,
    endPage: 229,
    sections: [
      { title: '§9.1 随机抽样、统计图表', page: 218 },
      { title: '§9.2 用样本估计总体', page: 222 },
      { title: '§9.3 成对数据的统计分析', page: 226 },
    ],
  },
  {
    title: '第十章 计数原理、概率、随机变量及其分布',
    page: 230,
    endPage: 259,
    sections: [
      { title: '§10.1 计数原理与排列组合', page: 230 },
      { title: '§10.2 二项式定理', page: 234 },
      { title: '§10.3 随机事件与概率', page: 236 },
      { title: '§10.4 事件的相互独立性与条件概率、全概率公式', page: 240 },
      { title: '§10.5 离散型随机变量及其分布列、数字特征', page: 242 },
      { title: '微拓展 均值、方差的大小比较、最值(范围)问题', page: 244 },
      { title: '§10.6 二项分布、超几何分布与正态分布', page: 246 },
      { title: '§10.7 概率与统计的综合问题', page: 250 },
      { title: '§10.8 概率、统计与其他知识的交汇问题[微重点]', page: 256 },
    ],
  },
]
