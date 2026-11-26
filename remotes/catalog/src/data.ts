export interface ProductVariant {
  id: string;
  label: string;
  priceDelta: number;
}

export interface ProductItem {
  id: string;
  name: string;
  category: 'Âm thanh' | 'Bàn phím' | 'Phụ kiện' | 'Màn hình & Desk';
  basePrice: number;
  initialStock: number;
  rating: number;
  reviewCount: number;
  badge?: string;
  shortSpec: string;
  icon: string;
  variants: ProductVariant[];
}

export const INITIAL_PRODUCTS: ProductItem[] = [
  {
    id: 'p1',
    name: 'Chuột Logitech Pebble 2 M350s Silent',
    category: 'Phụ kiện',
    basePrice: 590_000,
    initialStock: 6,
    rating: 4.8,
    reviewCount: 24,
    badge: 'Bán chạy',
    shortSpec: 'Bluetooth Multi-device • Click siêu êm • Pin 24 tháng',
    icon: '🖱️',
    variants: [
      { id: 'graphite', label: 'Đen Graphite', priceDelta: 0 },
      { id: 'white', label: 'Trắng Tonal', priceDelta: 30_000 },
      { id: 'rose', label: 'Hồng Rose', priceDelta: 50_000 }
    ]
  },
  {
    id: 'p2',
    name: 'Bàn phím cơ Royal Kludge RK75 Wireless',
    category: 'Bàn phím',
    basePrice: 950_000,
    initialStock: 5,
    rating: 4.9,
    reviewCount: 31,
    badge: 'Hot Deal',
    shortSpec: 'Layout 75% • Núm xoay CNC • Gasket Mount 3 Mode',
    icon: '⌨️',
    variants: [
      { id: 'linear', label: 'Cream Linear Switch', priceDelta: 0 },
      { id: 'tactile', label: 'Pale Green Tactile', priceDelta: 70_000 },
      { id: 'silent', label: 'Silent Peach Switch', priceDelta: 120_000 }
    ]
  },
  {
    id: 'p3',
    name: 'Tai nghe Anker Soundcore Space One ANC',
    category: 'Âm thanh',
    basePrice: 1_890_000,
    initialStock: 4,
    rating: 4.7,
    reviewCount: 18,
    badge: 'Hi-Res LDAC',
    shortSpec: 'Chống ồn chủ động 98% • Pin 55 giờ • Sạc nhanh USB-C',
    icon: '🎧',
    variants: [
      { id: 'jetblack', label: 'Jet Black', priceDelta: 0 },
      { id: 'latte', label: 'Latte Cream', priceDelta: 90_000 },
      { id: 'sky', label: 'Sky Blue', priceDelta: 90_000 }
    ]
  },
  {
    id: 'p4',
    name: 'Đèn treo màn hình Xiaomi Light Bar Pro',
    category: 'Màn hình & Desk',
    basePrice: 790_000,
    initialStock: 5,
    rating: 4.8,
    reviewCount: 29,
    shortSpec: 'Chỉ số hoàn màu Ra95 • Núm điều khiển không dây 2.4GHz',
    icon: '💡',
    variants: [
      { id: 'std', label: 'Bản tiêu chuẩn', priceDelta: 0 },
      { id: 'webcam-kit', label: 'Kèm ngàm Webcam', priceDelta: 110_000 }
    ]
  },
  {
    id: 'p5',
    name: 'Hub USB-C Ugreen Revodok Pro 7-in-1',
    category: 'Phụ kiện',
    basePrice: 650_000,
    initialStock: 7,
    rating: 4.6,
    reviewCount: 15,
    shortSpec: 'HDMI 4K@60Hz • PD 100W • SD/TF + 2×USB-A 3.2',
    icon: '🔌',
    variants: [
      { id: '4k60', label: '7-in-1 (HDMI 4K60Hz)', priceDelta: 0 },
      { id: 'lan-pro', label: '9-in-1 (+LAN Gigabit)', priceDelta: 240_000 }
    ]
  },
  {
    id: 'p6',
    name: 'Loa kiểm âm Edifier MR4 Studio Monitor',
    category: 'Âm thanh',
    basePrice: 1_650_000,
    initialStock: 3,
    rating: 4.9,
    reviewCount: 22,
    badge: 'Studio Grade',
    shortSpec: 'Công suất 42W RMS • Ngõ TRS Balanced • Chế độ Music/Monitor',
    icon: '🔊',
    variants: [
      { id: 'black', label: 'Đen Studio', priceDelta: 0 },
      { id: 'white', label: 'Trắng Minimal', priceDelta: 100_000 }
    ]
  }
];
