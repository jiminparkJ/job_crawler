/**
 * Shared terminology dictionary: Persian/English equivalents for job-hunting
 * vocabulary (titles, locations, employment types, remote policies).
 *
 * The dictionary is data, not code: it can be replaced/extended at runtime
 * (e.g. loaded from a config file) instead of being hardcoded at call sites.
 */

export interface TerminologyEntry {
  /** Canonical English key used internally. */
  canonical: string;
  /** All surface forms (English + Persian) recognized as this term. */
  forms: string[];
  category: TerminologyCategory;
}

export type TerminologyCategory =
  'title' | 'skill' | 'location' | 'employment_type' | 'remote_policy' | 'seniority' | 'industry';

export const DEFAULT_TERMINOLOGY: TerminologyEntry[] = [
  // ---- Titles -------------------------------------------------------------
  {
    canonical: 'backend_developer',
    forms: [
      'backend developer',
      'back-end developer',
      'backend engineer',
      'back-end engineer',
      'برنامه نویس بک اند',
      'برنامه‌نویس بک‌اند',
      'توسعه دهنده بک اند',
      'برنامه نویس سمت سرور',
    ],
    category: 'title',
  },
  {
    canonical: 'frontend_developer',
    forms: [
      'frontend developer',
      'front-end developer',
      'frontend engineer',
      'front-end engineer',
      'برنامه نویس فرانت اند',
      'برنامه‌نویس فرانت‌اند',
      'توسعه دهنده فرانت اند',
    ],
    category: 'title',
  },
  {
    canonical: 'fullstack_developer',
    forms: [
      'fullstack developer',
      'full stack developer',
      'full-stack developer',
      'full stack engineer',
      'فول استک',
      'برنامه نویس فول استک',
    ],
    category: 'title',
  },
  {
    canonical: 'software_engineer',
    forms: [
      'software engineer',
      'software developer',
      'مهندس نرم افزار',
      'مهندس نرم‌افزار',
      'برنامه نویس',
      'برنامه‌نویس',
      'توسعه دهنده نرم افزار',
    ],
    category: 'title',
  },
  {
    canonical: 'devops_engineer',
    forms: [
      'devops engineer',
      'devops',
      'site reliability engineer',
      'sre',
      'دواپس',
      'مهندس دواپس',
      'مهندس قابلیت اطمینان',
    ],
    category: 'title',
  },
  { canonical: 'data_engineer', forms: ['data engineer', 'مهندس داده'], category: 'title' },
  {
    canonical: 'data_scientist',
    forms: ['data scientist', 'دانشمند داده', 'علم داده'],
    category: 'title',
  },
  {
    canonical: 'machine_learning_engineer',
    forms: ['machine learning engineer', 'ml engineer', 'مهندس یادگیری ماشین', 'مهندس هوش مصنوعی'],
    category: 'title',
  },
  {
    canonical: 'qa_engineer',
    forms: [
      'qa engineer',
      'quality assurance',
      'software tester',
      'test engineer',
      'تستر',
      'مهندس تست',
      'تضمین کیفیت',
    ],
    category: 'title',
  },
  {
    canonical: 'product_manager',
    forms: ['product manager', 'product owner', 'مدیر محصول', 'مالک محصول'],
    category: 'title',
  },
  { canonical: 'project_manager', forms: ['project manager', 'مدیر پروژه'], category: 'title' },
  {
    canonical: 'ui_ux_designer',
    forms: [
      'ui designer',
      'ux designer',
      'ui/ux designer',
      'product designer',
      'طراح رابط کاربری',
      'طراح تجربه کاربری',
      'طراح محصول',
    ],
    category: 'title',
  },
  {
    canonical: 'mobile_developer',
    forms: [
      'mobile developer',
      'android developer',
      'ios developer',
      'flutter developer',
      'react native developer',
      'برنامه نویس موبایل',
      'توسعه دهنده موبایل',
    ],
    category: 'title',
  },
  {
    canonical: 'network_engineer',
    forms: ['network engineer', 'network administrator', 'مهندس شبکه', 'مدیر شبکه'],
    category: 'title',
  },
  {
    canonical: 'security_engineer',
    forms: ['security engineer', 'امنیت', 'مهندس امنیت', 'امنیت سایبری', 'security specialist'],
    category: 'title',
  },
  {
    canonical: 'database_administrator',
    forms: ['database administrator', 'dba', 'مدیر پایگاه داده', 'مهندس پایگاه داده'],
    category: 'title',
  },
  {
    canonical: 'system_administrator',
    forms: ['system administrator', 'sysadmin', 'مدیر سیستم', 'راهبر سامانه'],
    category: 'title',
  },
  {
    canonical: 'technical_lead',
    forms: [
      'tech lead',
      'technical lead',
      'team lead',
      'lead developer',
      'تیم لید',
      'تکنیکال لید',
      'سرپرست فنی',
      'مدیر تیم فنی',
    ],
    category: 'title',
  },
  {
    canonical: 'engineering_manager',
    forms: ['engineering manager', 'مدیر مهندسی', 'مدیر توسعه نرم افزار'],
    category: 'title',
  },
  {
    canonical: 'cto',
    forms: ['cto', 'chief technology officer', 'مدیر فناوری اطلاعات ارشد'],
    category: 'title',
  },

  // ---- Skills -------------------------------------------------------------
  {
    canonical: 'node.js',
    forms: ['node.js', 'nodejs', 'node js', 'نود جی اس', 'نود جی‌اس'],
    category: 'skill',
  },
  {
    canonical: 'typescript',
    forms: ['typescript', 'ts', 'تایپ‌اسکریپت', 'تایپ اسکریپت'],
    category: 'skill',
  },
  {
    canonical: 'javascript',
    forms: ['javascript', 'js', 'جاوااسکریپت', 'جاوا اسکریپت'],
    category: 'skill',
  },
  { canonical: 'python', forms: ['python', 'پایتون'], category: 'skill' },
  { canonical: 'java', forms: ['java', 'جاوا'], category: 'skill' },
  { canonical: 'c#', forms: ['c#', 'csharp', 'c sharp', 'سی شارپ'], category: 'skill' },
  { canonical: 'c++', forms: ['c++', 'cpp', 'سی پلاس پلاس'], category: 'skill' },
  { canonical: 'php', forms: ['php', 'پی اچ پی'], category: 'skill' },
  { canonical: 'golang', forms: ['golang', 'go', 'گولنگ'], category: 'skill' },
  { canonical: 'rust', forms: ['rust', 'راست'], category: 'skill' },
  { canonical: 'react', forms: ['react', 'react.js', 'reactjs', 'ری اکت'], category: 'skill' },
  { canonical: 'vue', forms: ['vue', 'vue.js', 'vuejs', 'ویو'], category: 'skill' },
  { canonical: 'angular', forms: ['angular', 'انگولار'], category: 'skill' },
  { canonical: 'next.js', forms: ['next.js', 'nextjs', 'next js', 'نکست'], category: 'skill' },
  {
    canonical: 'postgresql',
    forms: ['postgresql', 'postgres', 'psql', 'پستگرس', 'پست گرس'],
    category: 'skill',
  },
  { canonical: 'mysql', forms: ['mysql', 'مای اس کیو ال', 'مای‌اس‌کیو‌ال'], category: 'skill' },
  { canonical: 'mongodb', forms: ['mongodb', 'mongo', 'مونگو', 'مونگو دی بی'], category: 'skill' },
  { canonical: 'redis', forms: ['redis', 'ردیس'], category: 'skill' },
  { canonical: 'kafka', forms: ['kafka', 'کافکا'], category: 'skill' },
  { canonical: 'rabbitmq', forms: ['rabbitmq', 'rabbit mq', 'ربیت ام کیو'], category: 'skill' },
  {
    canonical: 'elasticsearch',
    forms: ['elasticsearch', 'elastic', 'ایلاستیک سرچ'],
    category: 'skill',
  },
  { canonical: 'docker', forms: ['docker', 'داکر'], category: 'skill' },
  {
    canonical: 'kubernetes',
    forms: ['kubernetes', 'k8s', 'کوبرنتیز', 'کوبرنتیز k8s'],
    category: 'skill',
  },
  { canonical: 'aws', forms: ['aws', 'amazon web services', 'ای دبلیو اس'], category: 'skill' },
  { canonical: 'azure', forms: ['azure', 'مایکروسافت آژور'], category: 'skill' },
  {
    canonical: 'linux',
    forms: ['linux', 'لینوکس', 'ubuntu', 'debian', 'centos'],
    category: 'skill',
  },
  { canonical: 'git', forms: ['git', 'گیت', 'github', 'gitlab', 'bitbucket'], category: 'skill' },
  {
    canonical: 'ci/cd',
    forms: [
      'ci/cd',
      'cicd',
      'ci cd',
      'continuous integration',
      'continuous delivery',
      'سی آی سی دی',
    ],
    category: 'skill',
  },
  {
    canonical: 'rest_api',
    forms: ['rest api', 'restful', 'rest', 'api', 'web api', 'وب سرویس', 'restful api'],
    category: 'skill',
  },
  { canonical: 'graphql', forms: ['graphql', 'graph ql', 'گراف کیو ال'], category: 'skill' },
  {
    canonical: 'microservices',
    forms: ['microservices', 'microservice', 'micro-services', 'میکروسرویس', 'میکرو سرویس'],
    category: 'skill',
  },
  { canonical: 'agile', forms: ['agile', 'scrum', 'kanban', 'اجایل', 'اسکرام'], category: 'skill' },
  { canonical: 'html', forms: ['html', 'html5', 'اچ تی ام ال'], category: 'skill' },
  { canonical: 'css', forms: ['css', 'css3', 'سی اس اس'], category: 'skill' },
  {
    canonical: 'tailwind',
    forms: ['tailwind', 'tailwindcss', 'tailwind css', 'تیلویند'],
    category: 'skill',
  },
  { canonical: 'sass', forms: ['sass', 'scss', 'less'], category: 'skill' },
  { canonical: 'jest', forms: ['jest', 'vitest', 'mocha', 'jasmine', 'تست جی'], category: 'skill' },
  { canonical: 'webpack', forms: ['webpack', 'vite', 'rollup', 'ویت'], category: 'skill' },
  { canonical: 'figma', forms: ['figma', 'فیگما'], category: 'skill' },
  { canonical: 'django', forms: ['django', 'جنگو'], category: 'skill' },
  { canonical: 'flask', forms: ['flask', 'فلاسک'], category: 'skill' },
  { canonical: 'laravel', forms: ['laravel', 'لاراول'], category: 'skill' },
  { canonical: 'spring', forms: ['spring', 'spring boot', 'اسپرینگ'], category: 'skill' },
  {
    canonical: 'asp.net',
    forms: ['asp.net', 'asp net', 'asp.net core', 'ای اس پی دات نت'],
    category: 'skill',
  },
  { canonical: '.net', forms: ['.net', 'dotnet', 'دات نت'], category: 'skill' },
  { canonical: 'unity', forms: ['unity', 'یونیتی'], category: 'skill' },
  { canonical: 'flutter', forms: ['flutter', 'فلاتر'], category: 'skill' },
  { canonical: 'nuxt', forms: ['nuxt', 'nuxtjs', 'nuxt.js'], category: 'skill' },
  {
    canonical: 'express',
    forms: ['express', 'expressjs', 'express.js', 'اکسپرس'],
    category: 'skill',
  },
  { canonical: 'nestjs', forms: ['nestjs', 'nest.js', 'nest js', 'نست'], category: 'skill' },
  {
    canonical: 'socket.io',
    forms: ['socket.io', 'websocket', 'websockets', 'سوکت'],
    category: 'skill',
  },
  { canonical: 'nginx', forms: ['nginx', 'انجینکس', 'انجین ایکس'], category: 'skill' },
  { canonical: 'terraform', forms: ['terraform', 'ترافورم'], category: 'skill' },
  { canonical: 'ansible', forms: ['ansible', 'انسیبل'], category: 'skill' },
  {
    canonical: 'prometheus',
    forms: ['prometheus', 'grafana', 'پرومتئوس', 'گرافانا'],
    category: 'skill',
  },

  // ---- Locations ----------------------------------------------------------
  { canonical: 'tehran', forms: ['tehran', 'تهران'], category: 'location' },
  { canonical: 'isfahan', forms: ['isfahan', 'esfahan', 'اصفهان'], category: 'location' },
  { canonical: 'mashhad', forms: ['mashhad', 'مشهد'], category: 'location' },
  { canonical: 'karaj', forms: ['karaj', 'کرج'], category: 'location' },
  { canonical: 'shiraz', forms: ['shiraz', 'شیراز'], category: 'location' },
  { canonical: 'tabriz', forms: ['tabriz', 'تبریز'], category: 'location' },
  { canonical: 'ahvaz', forms: ['ahvaz', 'اهواز'], category: 'location' },
  { canonical: 'qom', forms: ['qom', 'قم'], category: 'location' },
  { canonical: 'rasht', forms: ['rasht', 'رشت'], category: 'location' },
  { canonical: 'kerman', forms: ['kerman', 'کرمان'], category: 'location' },
  { canonical: 'yazd', forms: ['yazd', 'یزد'], category: 'location' },
  {
    canonical: 'bandar_abbas',
    forms: ['bandar abbas', 'بندرعباس', 'بندر عباس'],
    category: 'location',
  },
  { canonical: 'qazvin', forms: ['qazvin', 'قزوین'], category: 'location' },
  { canonical: 'kermanshah', forms: ['kermanshah', 'کرمانشاه'], category: 'location' },
  { canonical: 'zahedan', forms: ['zahedan', 'زاهدان'], category: 'location' },
  { canonical: 'urmia', forms: ['urmia', 'orumieh', 'ارومیه'], category: 'location' },
  { canonical: 'kashan', forms: ['kashan', 'کاشان'], category: 'location' },
  {
    canonical: 'remote',
    forms: [
      'remote',
      'remotely',
      'work from home',
      'wfh',
      'دورکاری',
      'دور کار',
      'از راه دور',
      'غیرحضوری',
    ],
    category: 'location',
  },
  {
    canonical: 'hybrid',
    forms: ['hybrid', 'ترکیبی', 'نیمه حضوری', 'حضوری و دورکار'],
    category: 'location',
  },

  // ---- Employment types ----------------------------------------------------
  {
    canonical: 'full_time',
    forms: ['full time', 'full-time', 'تمام وقت', 'تمام‌وقت'],
    category: 'employment_type',
  },
  {
    canonical: 'part_time',
    forms: ['part time', 'part-time', 'پاره وقت', 'پاره‌وقت', 'نیمه وقت'],
    category: 'employment_type',
  },
  {
    canonical: 'contract',
    forms: ['contract', 'contractor', 'قراردادی', 'پروژه ای', 'پروژه‌ای'],
    category: 'employment_type',
  },
  {
    canonical: 'internship',
    forms: ['internship', 'intern', 'کارآموزی', 'کارآموز'],
    category: 'employment_type',
  },
  {
    canonical: 'freelance',
    forms: ['freelance', 'freelancer', 'فریلنس', 'فریلنسر'],
    category: 'employment_type',
  },
  {
    canonical: 'temporary',
    forms: ['temporary', 'temp', 'موقت', 'موقتی'],
    category: 'employment_type',
  },

  // ---- Remote policies -----------------------------------------------------
  {
    canonical: 'remote',
    forms: ['remote', 'remotely', 'دورکاری', 'از راه دور', 'غیرحضوری'],
    category: 'remote_policy',
  },
  {
    canonical: 'onsite',
    forms: ['onsite', 'on-site', 'on site', 'حضوری', 'در محل شرکت'],
    category: 'remote_policy',
  },
  { canonical: 'hybrid', forms: ['hybrid', 'ترکیبی', 'نیمه‌حضوری'], category: 'remote_policy' },

  // ---- Seniority -----------------------------------------------------------
  {
    canonical: 'junior',
    forms: ['junior', 'jr', 'jr.', 'جونیور', 'تازه‌کار', 'تازه کار', 'کم‌تجربه'],
    category: 'seniority',
  },
  {
    canonical: 'mid_level',
    forms: ['mid-level', 'mid level', 'mid', 'میان‌رده', 'میان رده', 'میانه'],
    category: 'seniority',
  },
  {
    canonical: 'senior',
    forms: ['senior', 'sr', 'sr.', 'سنیور', 'seniority:senior'],
    category: 'seniority',
  },
  { canonical: 'lead', forms: ['lead', 'team lead', 'تیم لید', 'سرپرست'], category: 'seniority' },
  {
    canonical: 'principal',
    forms: ['principal', 'staff engineer', 'پرینسیپال', 'استف انجینر'],
    category: 'seniority',
  },
  { canonical: 'manager', forms: ['manager', 'مدیر'], category: 'seniority' },

  // ---- Industries ----------------------------------------------------------
  { canonical: 'fintech', forms: ['fintech', 'فین تک', 'فین‌تک'], category: 'industry' },
  {
    canonical: 'ecommerce',
    forms: ['e-commerce', 'ecommerce', 'خرید اینترنتی', 'فروشگاه اینترنتی'],
    category: 'industry',
  },
  {
    canonical: 'healthcare',
    forms: ['healthcare', 'health tech', 'سلامت دیجیتال', 'درمان'],
    category: 'industry',
  },
  {
    canonical: 'gaming',
    forms: ['gaming', 'game', 'game development', 'بازی سازی', 'صنعت بازی'],
    category: 'industry',
  },
  { canonical: 'saas', forms: ['saas', 'software as a service', 'ساس'], category: 'industry' },
];
