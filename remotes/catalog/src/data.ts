export interface ProductVariant {
  id: string;
  label: string;
  priceDelta: number;
}

export interface ProductItem {
  id: string;
  code: string;
  name: string;
  category: 'Âm thanh' | 'Bàn phím' | 'Phụ kiện' | 'Màn hình & Desk' | 'Trà';
  basePrice: number;
  initialStock: number;
  rating: number;
  reviewCount: number;
  badge?: string;
  shortSpec: string;
  variants: ProductVariant[];
}

export const INITIAL_PRODUCTS: ProductItem[] = [
  ...['T-02', 'T-03', 'T-04', 'T-01'].map((code, index): ProductItem => ({
    id: code, code, name: ['Trà xanh Thái Nguyên', 'Trà sen Tây Hồ', 'Trà lài', 'Trà ô long'][index],
    category: 'Trà', basePrice: 120_000 + index * 10_000, initialStock: 20, rating: 4.8, reviewCount: 0,
    shortSpec: 'Trà lá nguyên chất, gói 100g', variants: [{ id: 'standard', label: '100g', priceDelta: 0 }]
  })),
  {
    id: 'p1',
    code: 'LOGI-M350',
    name: 'Chuột Logitech Pebble 2 M350s Silent',
    category: 'Phụ kiện',
    basePrice: 590_000,
    initialStock: 6,
    rating: 4.8,
    reviewCount: 24,
    badge: 'Bán chạy',
    shortSpec: 'Bluetooth Multi-device, click giảm ồn, pin 24 tháng',
    variants: [
      { id: 'graphite', label: 'Đen Graphite', priceDelta: 0 },
      { id: 'white', label: 'Trắng Tonal', priceDelta: 30_000 },
      { id: 'rose', label: 'Hồng Rose', priceDelta: 50_000 }
    ]
  },
  {
    id: 'p2',
    code: 'RK-75PRO',
    name: 'Bàn phím cơ Royal Kludge RK75 Wireless',
    category: 'Bàn phím',
    basePrice: 950_000,
    initialStock: 5,
    rating: 4.9,
    reviewCount: 31,
    badge: 'Mới',
    shortSpec: 'Layout 75%, núm xoay nhôm CNC, Gasket Mount 3 chế độ',
    variants: [
      { id: 'linear', label: 'Cream Linear Switch', priceDelta: 0 },
      { id: 'tactile', label: 'Pale Green Tactile', priceDelta: 70_000 },
      { id: 'silent', label: 'Silent Peach Switch', priceDelta: 120_000 }
    ]
  },
  {
    id: 'p3',
    code: 'ANK-S1',
    name: 'Tai nghe Anker Soundcore Space One ANC',
    category: 'Âm thanh',
    basePrice: 1_890_000,
    initialStock: 4,
    rating: 4.7,
    reviewCount: 18,
    badge: 'LDAC',
    shortSpec: 'Chống ồn chủ động ANC, pin 55 giờ, sạc nhanh USB-C',
    variants: [
      { id: 'jetblack', label: 'Jet Black', priceDelta: 0 },
      { id: 'latte', label: 'Latte Cream', priceDelta: 90_000 },
      { id: 'sky', label: 'Sky Blue', priceDelta: 90_000 }
    ]
  },
  {
    id: 'p4',
    code: 'MI-BAR',
    name: 'Đèn treo màn hình Xiaomi Light Bar Pro',
    category: 'Màn hình & Desk',
    basePrice: 790_000,
    initialStock: 5,
    rating: 4.8,
    reviewCount: 29,
    shortSpec: 'Độ hoàn màu Ra95, điều khiển xoay không dây 2.4GHz',
    variants: [
      { id: 'std', label: 'Bản tiêu chuẩn', priceDelta: 0 },
      { id: 'webcam-kit', label: 'Kèm ngàm Webcam', priceDelta: 110_000 }
    ]
  },
  {
    id: 'p5',
    code: 'UGR-7IN1',
    name: 'Hub USB-C Ugreen Revodok Pro 7-in-1',
    category: 'Phụ kiện',
    basePrice: 650_000,
    initialStock: 7,
    rating: 4.6,
    reviewCount: 15,
    shortSpec: 'HDMI 4K@60Hz, sạc PD 100W, khe đọc thẻ SD/TF, USB 3.2',
    variants: [
      { id: '4k60', label: '7-in-1 (HDMI 4K60Hz)', priceDelta: 0 },
      { id: 'lan-pro', label: '9-in-1 (Thêm cổng LAN)', priceDelta: 240_000 }
    ]
  },
  {
    id: 'p6',
    code: 'EDI-MR4',
    name: 'Loa kiểm âm Edifier MR4 Studio Monitor',
    category: 'Âm thanh',
    basePrice: 1_650_000,
    initialStock: 3,
    rating: 4.9,
    reviewCount: 22,
    badge: 'Studio',
    shortSpec: 'Công suất 42W RMS, ngõ TRS Balanced, chế độ Music/Monitor',
    variants: [
      { id: 'black', label: 'Đen Studio', priceDelta: 0 },
      { id: 'white', label: 'Trắng Minimal', priceDelta: 100_000 }
    ]
  }
];
