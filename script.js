// File: script.js - FINAL VERSION WITH CACHE SYSTEM
// Konfigurasi Google Apps Script Web App URL
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxj-deVY8jiKnAA_h1N2tdDPZ4efGmfSokNQTCSNRF8VKUj8aAvOio1cN6Bf07rfumq_A/exec';

// ==================== CACHE SYSTEM CONFIGURATION ====================
const CACHE_CONFIG = {
    // Cache duration in milliseconds
    DURATIONS: {
        STATIC: 30 * 60 * 1000,      // 30 menit untuk data statis
        DYNAMIC: 5 * 60 * 1000,      // 5 menit untuk data dinamis
        SHORT: 2 * 60 * 1000,        // 2 menit untuk data yang sering berubah
        USER_SESSION: 60 * 60 * 1000 // 1 jam untuk session user
    },
    
    // Batch configuration
    BATCH_DELAY: 100, // Delay antara batch calls (ms)
    MAX_CONCURRENT: 2, // Maksimal concurrent requests
    
    // Cache keys
    KEYS: {
        PROGRAMS: 'programs_data',
        PROMOS: 'promos_data',
        TESTIMONIALS: 'testimonials_data',
        KARIR: 'karir_data',
        PROFIL: 'profil_lembaga',
        STATS: 'stats_data',
        KEUNGGULAN: 'keunggulan_data',
        TENTANG: 'tentang_kami_data'
    }
};

// ==================== CACHE STORAGE & STATE ====================
const appCache = {
    data: new Map(),
    pendingRequests: new Map(),
    activeRequests: 0,
    
    // Cache statistics
    stats: {
        hits: 0,
        misses: 0,
        saves: 0,
        batchCount: 0
    }
};

// Global State
let currentPrograms = [];
let currentPromos = [];
let currentProgramPromos = null;

// ==================== PROGRESS INDICATORS ====================
const ProgressManager = {
    indicators: new Map(),
    
    show(containerId, message = 'Memuat data...') {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        const indicatorId = `progress-${containerId}-${Date.now()}`;
        this.indicators.set(containerId, indicatorId);
        
        container.innerHTML = `
            <div id="${indicatorId}" class="progress-indicator">
                <div class="progress-spinner"></div>
                <div class="progress-text">${message}</div>
                <div class="progress-bar">
                    <div class="progress-fill"></div>
                </div>
            </div>
        `;
    },
    
    update(containerId, progress) {
        const indicatorId = this.indicators.get(containerId);
        if (!indicatorId) return;
        
        const indicator = document.getElementById(indicatorId);
        if (indicator) {
            const fill = indicator.querySelector('.progress-fill');
            const text = indicator.querySelector('.progress-text');
            if (fill) fill.style.width = `${progress}%`;
            if (text) text.textContent = `Memuat data... ${progress}%`;
        }
    },
    
    hide(containerId) {
        this.indicators.delete(containerId);
    }
};

// ==================== CACHE MANAGEMENT ====================
const CacheManager = {
    // Get data from cache dengan validasi expiry
    get(key) {
        const cached = appCache.data.get(key);
        if (!cached) {
            appCache.stats.misses++;
            return null;
        }
        
        const now = Date.now();
        if (now > cached.expiry) {
            appCache.data.delete(key);
            appCache.stats.misses++;
            return null;
        }
        
        appCache.stats.hits++;
        console.log(`🎯 Cache HIT for ${key} (${this.getHitRate()}% hit rate)`);
        return cached.data;
    },
    
    // Set data to cache dengan expiry
    set(key, data, duration = CACHE_CONFIG.DURATIONS.DYNAMIC) {
        const expiry = Date.now() + duration;
        appCache.data.set(key, { data, expiry });
        appCache.stats.saves++;
        console.log(`💾 Cache SET for ${key}, expires in ${duration/1000}s`);
    },
    
    // Clear specific cache
    clear(key) {
        appCache.data.delete(key);
        console.log(`🧹 Cache CLEARED for ${key}`);
    },
    
    // Clear all cache
    clearAll() {
        appCache.data.clear();
        console.log('🧹 All cache CLEARED');
    },
    
    // Get cache statistics
    getStats() {
        const hitRate = this.getHitRate();
        return {
            ...appCache.stats,
            hitRate: hitRate,
            size: appCache.data.size
        };
    },
    
    // Calculate hit rate
    getHitRate() {
        const total = appCache.stats.hits + appCache.stats.misses;
        return total > 0 ? Math.round((appCache.stats.hits / total) * 100) : 0;
    },
    
    // Preload critical data
    async preloadCriticalData() {
        console.log('🚀 Preloading critical cache data...');
        const criticalLoads = [
            this.loadWithCache(CACHE_CONFIG.KEYS.PROGRAMS, 'getProgramAktif', {}, CACHE_CONFIG.DURATIONS.STATIC),
            this.loadWithCache(CACHE_CONFIG.KEYS.PROMOS, 'getPromoAktif', {}, CACHE_CONFIG.DURATIONS.SHORT),
            this.loadWithCache(CACHE_CONFIG.KEYS.PROFIL, 'getProfilLembaga', {}, CACHE_CONFIG.DURATIONS.STATIC)
        ];
        
        await Promise.allSettled(criticalLoads);
        console.log('✅ Critical data preloaded');
    },
    
    // Generic cache loader
    async loadWithCache(cacheKey, functionName, params = {}, duration = CACHE_CONFIG.DURATIONS.DYNAMIC) {
        // Check cache first
        const cached = this.get(cacheKey);
        if (cached) {
            return cached;
        }
        
        // If request already pending, wait for it
        if (appCache.pendingRequests.has(cacheKey)) {
            console.log(`⏳ Waiting for pending request: ${cacheKey}`);
            return await appCache.pendingRequests.get(cacheKey);
        }
        
        // Make new request dengan concurrency control
        while (appCache.activeRequests >= CACHE_CONFIG.MAX_CONCURRENT) {
            console.log('⏳ Waiting for available slot...');
            await new Promise(resolve => setTimeout(resolve, CACHE_CONFIG.BATCH_DELAY));
        }
        
        appCache.activeRequests++;
        const requestPromise = this.makeRequest(functionName, params, cacheKey, duration);
        appCache.pendingRequests.set(cacheKey, requestPromise);
        
        try {
            const result = await requestPromise;
            return result;
        } finally {
            appCache.activeRequests--;
            appCache.pendingRequests.delete(cacheKey);
        }
    },
    
    // Make actual request
    async makeRequest(functionName, params, cacheKey, duration) {
        try {
            console.log(`🌐 Fetching fresh data for: ${cacheKey}`);
            const response = await callGoogleScript(functionName, params);
            
            if (response.success) {
                const data = response.data || response;
                this.set(cacheKey, data, duration);
                return data;
            } else {
                throw new Error(response.message || `Request failed for ${functionName}`);
            }
        } catch (error) {
            console.error(`❌ Cache load failed for ${cacheKey}:`, error);
            throw error;
        }
    }
};

// ==================== 1. INITIALIZATION FUNCTIONS ====================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 DOM Ready - Initializing Smart Catalyst App with Cache System...');
    initializeApp();
});

async function initializeApp() {
    console.log('🚀 Initializing Smart Catalyst App...');
    
    // Preload critical data untuk cache
    await CacheManager.preloadCriticalData();
    
    setupNavigation();
    loadPageData();
    loadProfilLembaga();
    
    // Log cache stats setelah inisialisasi
    setTimeout(() => {
        const stats = CacheManager.getStats();
        console.log('📊 Cache Statistics:', stats);
    }, 2000);
    
    console.log('✅ App initialization complete');
}

function getCurrentPage() {
    const path = window.location.pathname;
    const page = path.split('/').pop() || 'index.html';
    console.log('📄 Current page:', page);
    return page;
}

function loadPageData() {
    const currentPage = getCurrentPage();
    console.log('📦 Loading data for page:', currentPage);
    
    switch(currentPage) {
        case 'index.html':
        case '/':
            loadHomepageData();
            break;
        case 'program.html':
            loadProgramsData();
            break;
        case 'program-detail.html':
            loadProgramDetail();
            break;
        case 'promo.html':
            loadPromosData();
            break;
        case 'promo-detail.html': 
            loadPromoDetail();
            break;
        case 'testimoni.html':
            loadTestimonialsData();
            break;
        case 'karir.html':
            loadKarirData();
            break;
        case 'karir-detail.html':
            loadKarirDetail();
            break;
        case 'registrasi.html':
            initializeRegistrationForm();
            break;
        case 'registrasi-tutor.html':
            initializeTutorForm();
            break;
        default:
            console.log('⚠️ No specific data loader for:', currentPage);
    }
}

// ==================== 2. CORE API FUNCTIONS ====================

async function callGoogleScript(functionName, data = {}) {
    console.log(`🔄 Calling Google Script: ${functionName}`, data);
    return await callWithJSONP(functionName, data);
}

function callWithJSONP(functionName, data) {
    return new Promise((resolve, reject) => {
        const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        window[callbackName] = function(response) {
            console.log(`📨 Response received for ${functionName}:`, response);
            
            delete window[callbackName];
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            
            if (response && typeof response === 'object') {
                if (response.success !== undefined) {
                    if (response.success) {
                        resolve(response);
                    } else {
                        reject(new Error(response.message || 'Request failed'));
                    }
                } else {
                    resolve(response);
                }
            } else {
                reject(new Error('Invalid response format'));
            }
        };
        
        const script = document.createElement('script');
        const params = new URLSearchParams();
        
        params.append('function', functionName);
        if (Object.keys(data).length > 0) {
            params.append('data', JSON.stringify(data));
        }
        params.append('callback', callbackName);
        
        const url = SCRIPT_URL + '?' + params.toString();
        console.log(`🌐 Request URL: ${url}`);
        
        script.src = url;
        
        script.onerror = function() {
            console.error('❌ Script load error for:', functionName);
            delete window[callbackName];
            if (script.parentNode) {
                script.parentNode.removeChild(script);
            }
            reject(new Error(`Network error - Gagal memuat data untuk ${functionName}`));
        };
        
        document.head.appendChild(script);
        
        const timeout = setTimeout(() => {
           if (window[callbackName]) {
           delete window[callbackName];
           if (script.parentNode) {
          script.parentNode.removeChild(script);
          }
            reject(new Error(`Request timeout untuk ${functionName}`));
        }
        }, 45000);
        
        script.onload = function() {
            clearTimeout(timeout);
        };
    });
}

// ==================== 3. BASIC SETUP FUNCTIONS ====================

function setupNavigation() {
    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-menu');
    
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
        });
    }
    
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (navMenu) navMenu.classList.remove('active');
        });
    });
}

// ==================== 4. PROFIL LEMBAGA FUNCTIONS ====================

async function loadProfilLembaga() {
    try {
        const profil = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.PROFIL, 
            'getProfilLembaga', 
            {}, 
            CACHE_CONFIG.DURATIONS.STATIC
        );
        
        if (profil) {
            updateFooterInfo(profil);
            updateContactInfo(profil);
        }
    } catch (error) {
        console.error('Error loading profil lembaga:', error);
    }
}

function updateFooterInfo(profil) {
    const footerSections = document.querySelectorAll('.footer-section');
    
    footerSections.forEach(section => {
        const heading = section.querySelector('h3');
        if (heading && heading.textContent.includes('Smart Catalyst')) {
            const desc = section.querySelector('p');
            if (desc && profil.deskripsi) {
                desc.textContent = profil.deskripsi;
            }
        }
        
        if (heading && heading.textContent.includes('Kontak Kami')) {
            updateContactSection(section, profil);
        }
    });
}

function updateContactSection(section, profil) {
    const contactHTML = `
        <div class="contact-item">
            <img src="LOGO_WA.png" alt="WhatsApp" class="contact-logo">
            <a href="https://wa.me/${profil.telepon ? profil.telepon.replace(/\D/g, '') : '6285180649460'}" target="_blank" class="contact-link">
                WhatsApp
            </a>
        </div>
        <div class="contact-item">
            <img src="LOGO_IG.png" alt="Instagram" class="contact-logo">
            <a href="${profil.instagram || 'https://instagram.com/smart_catalyst.psw'}" target="_blank" class="contact-link">
                Instagram
            </a>
        </div>
        <div class="contact-item">
            <img src="LOGO_EMAIL.png" alt="Email" class="contact-logo">
            <a href="mailto:${profil.email || 'muhammadfadilkamal@gmail.com'}" class="contact-link">
                Email
            </a>
        </div>
        <div class="contact-item">
            <img src="LOGO_GMAPS.png" alt="Lokasi" class="contact-logo">
            <span class="contact-text">${profil.alamat || 'Pringsewu Selatan, Pringsewu, Lampung'}</span>
        </div>
    `;
    
    section.innerHTML = '<h3>Kontak Kami</h3>' + contactHTML;
}

function updateContactInfo(profil) {
    const contactElements = document.querySelectorAll('[data-contact]');
    contactElements.forEach(element => {
        const contactType = element.getAttribute('data-contact');
        switch(contactType) {
            case 'whatsapp':
                element.href = `https://wa.me/${profil.telepon ? profil.telepon.replace(/\D/g, '') : '6285180649460'}`;
                break;
            case 'instagram':
                element.href = profil.instagram || 'https://instagram.com/smartcatalyst';
                break;
            case 'email':
                element.href = `mailto:${profil.email || 'info@smartcatalyst.com'}`;
                break;
        }
    });
}

// ==================== 5. HOME PAGE FUNCTIONS ====================

async function loadHomepageData() {
    console.log('🏠 Loading homepage data with cache...');
    
    try {
        // Show progress indicators
        ProgressManager.show('statsContainer', 'Memuat statistik...');
        ProgressManager.show('keunggulanContainer', 'Memuat keunggulan...');
        ProgressManager.show('tentangKamiContainer', 'Memuat tentang kami...');
        
        // Load data secara parallel dengan cache
        const [stats, keunggulan, tentang] = await Promise.allSettled([
            loadStats(),
            loadKeunggulan(),
            loadTentangKami()
        ]);
        
        // Update progress
        ProgressManager.update('statsContainer', 70);
        ProgressManager.update('keunggulanContainer', 70);
        ProgressManager.update('tentangKamiContainer', 70);
        
        // Load remaining data
        await Promise.allSettled([
            loadProgramsPreview(),
            loadTestimonialsPreview()
        ]);
        
        // Hide progress indicators
        ProgressManager.hide('statsContainer');
        ProgressManager.hide('keunggulanContainer');
        ProgressManager.hide('tentangKamiContainer');
        
        console.log('✅ Homepage data loaded successfully with cache');
    } catch (error) {
        console.error('❌ Error loading homepage data:', error);
        showError('Gagal memuat data. Silakan refresh halaman.');
    }
}

async function loadStats() {
    const container = document.getElementById('statsContainer');
    if (!container) return;
    
    try {
        ProgressManager.update('statsContainer', 30);
        
        const stats = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.STATS,
            'getStatistik',
            {},
            CACHE_CONFIG.DURATIONS.SHORT
        );
        
        ProgressManager.update('statsContainer', 80);
        
        if (stats) {
            container.innerHTML = `
                <div class="stat-card">
                    <div class="stat-number">${stats.jumlah_siswa}+</div>
                    <div class="stat-label">Siswa Aktif</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.jumlah_tutor}+</div>
                    <div class="stat-label">Tutor Profesional</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.jumlah_program}</div>
                    <div class="stat-label">Program Belajar</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.jumlah_promo}</div>
                    <div class="stat-label">Promo Aktif</div>
                </div>
            `;
        } else {
            throw new Error('Data statistik tidak tersedia');
        }
        
        ProgressManager.update('statsContainer', 100);
    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 2rem;">
                <p style="color: #666;">⚠️ Gagal memuat statistik: ${error.message}</p>
                <button onclick="loadStats()" class="btn btn-primary" style="margin-top: 1rem;">
                    🔄 Coba Lagi
                </button>
            </div>
        `;
        ProgressManager.hide('statsContainer');
    }
}

async function loadKeunggulan() {
    const container = document.getElementById('keunggulanContainer');
    if (!container) return;
    
    try {
        ProgressManager.update('keunggulanContainer', 30);
        
        const keunggulan = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.KEUNGGULAN,
            'getKeunggulan',
            {},
            CACHE_CONFIG.DURATIONS.STATIC
        );
        
        ProgressManager.update('keunggulanContainer', 80);
        
        if (!keunggulan || keunggulan.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                    <h3 style="color: #666; margin-bottom: 1rem;">⭐ Keunggulan Kami</h3>
                    <p style="color: #999;">Kami berkomitmen memberikan yang terbaik untuk pendidikan anak Anda.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keunggulan.map(item => `
            <div class="feature-card">
                <div class="feature-icon">${item.icon || '⭐'}</div>
                <h3 class="feature-title">${item.judul || 'Keunggulan'}</h3>
                <p class="feature-description">${item.deskripsi || ''}</p>
            </div>
        `).join('');
        
        ProgressManager.update('keunggulanContainer', 100);
    } catch (error) {
        console.error('Error loading keunggulan:', error);
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #666; margin-bottom: 1rem;">⭐ Keunggulan Kami</h3>
                <p style="color: #999;">Kami berkomitmen memberikan yang terbaik untuk pendidikan anak Anda.</p>
            </div>
        `;
        ProgressManager.hide('keunggulanContainer');
    }
}

async function loadTentangKami() {
    const container = document.getElementById('tentangKamiContainer');
    if (!container) return;
    
    try {
        ProgressManager.update('tentangKamiContainer', 30);
        
        const tentang = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.TENTANG,
            'getTentangKami',
            {},
            CACHE_CONFIG.DURATIONS.STATIC
        );
        
        ProgressManager.update('tentangKamiContainer', 80);
        
        container.innerHTML = `
            <div class="about-content">
                <div class="about-text">
                    <h2>Tentang Smart Catalyst</h2>
                    <p>${tentang.deskripsi_lengkap || 'Lembaga bimbingan belajar profesional dengan pengajar berkualitas dan metode pembelajaran yang menyenangkan.'}</p>
                    
                    ${tentang.visi ? `
                        <div class="vision-mission">
                            <h3>🦅 Visi</h3>
                            <p>${tentang.visi}</p>
                        </div>
                    ` : ''}
                    
                    ${tentang.misi ? `
                        <div class="vision-mission">
                            <h3>🎯 Misi</h3>
                            <ul>
                                ${tentang.misi.split('\n').map(item => item.trim()).filter(item => item).map(item => `
                                    <li>${item}</li>
                                `).join('')}
                            </ul>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        ProgressManager.update('tentangKamiContainer', 100);
    } catch (error) {
        console.error('Error loading tentang kami:', error);
        container.innerHTML = `
            <div class="about-content">
                <div class="about-text">
                    <h2>Tentang Smart Catalyst</h2>
                    <p>Lembaga bimbingan belajar profesional dengan pengajar berkualitas dan metode pembelajaran yang menyenangkan. Fokus pada pengembangan potensi akademik dan karakter siswa.</p>
                </div>
            </div>
        `;
        ProgressManager.hide('tentangKamiContainer');
    }
}

async function loadProgramsPreview() {
    const container = document.getElementById('programsContainer');
    if (!container) return;
    
    ProgressManager.show('programsContainer', 'Memuat program...');
    
    try {
        ProgressManager.update('programsContainer', 30);
        
        const [programs, promos] = await Promise.all([
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROGRAMS,
                'getProgramAktif',
                {},
                CACHE_CONFIG.DURATIONS.DYNAMIC
            ),
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROMOS,
                'getPromoAktif',
                {},
                CACHE_CONFIG.DURATIONS.SHORT
            )
        ]);
        
        ProgressManager.update('programsContainer', 70);
        
        currentPrograms = programs.slice(0, 3);
        const activePromos = promos || [];
        
        if (currentPrograms.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                    <h3 style="color: #666; margin-bottom: 1rem;">📚 Belum Ada Program</h3>
                    <p style="color: #999;">Saat ini belum ada program yang tersedia.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = currentPrograms.map(program => {
            const programPromo = activePromos.find(promo => promo.id_program === program.id_program);
            const finalPrice = programPromo ? 
                program.harga * (1 - programPromo.diskon_percent / 100) : 
                program.harga;
            
            const programImage = extractImageFromProgram(program);
            
            return `
        <div class="program-card">
            <div class="program-image-container">
                <img src="${programImage}" 
                     alt="${program.nama_program}" 
                     class="program-image"
                     loading="lazy"
                     onerror="this.onerror=null; this.src='${getDefaultProgramImage(program.jenjang)}'">
                ${programPromo ? `
                    <div class="image-badge">🎉 Promo ${programPromo.diskon_percent}%</div>
                ` : ''}
            </div>
            <div class="program-content">
                <h3 class="program-title">${program.nama_program}</h3>
                <div class="program-jenjang">${program.jenjang}</div>
                
                <p class="program-description">${program.deskripsi}</p>
                
                ${programPromo ? `
                    <div class="program-promo">
                        🎉 Hemat ${programPromo.diskon_percent}% - 
                        Hanya Rp ${finalPrice.toLocaleString('id-ID')}
                    </div>
                    <div class="program-price" style="text-decoration: line-through; color: #ef4444; font-size: 1rem;">
                        Rp ${program.harga.toLocaleString('id-ID')}
                    </div>
                ` : `
                    <div class="program-price">Rp ${program.harga.toLocaleString('id-ID')}</div>
                `}
                
                <div class="program-actions" style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                    <button class="btn btn-success" onclick="viewProgramDetail('${program.id_program}')" style="flex: 2;">
                     Lihat Detail
                    </button>
                    <button class="btn btn-outline" onclick="downloadBrosurProgram('${program.id_program}', '${program.nama_program}')" 
                        style="flex: 1; background: transparent; border: 2px solid #3b82f6; color: #3b82f6;"
                      title="Unduh Brosur">
                    📥 Brosur
                    </button>
                </div>
            </div>
        </div>
    `;
        }).join('');
        
        ProgressManager.update('programsContainer', 100);
        setTimeout(() => ProgressManager.hide('programsContainer'), 500);
        
    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Gagal Memuat Program</h3>
                <p style="color: #666; margin-bottom: 1.5rem;">${error.message}</p>
                <button onclick="loadProgramsPreview()" class="btn btn-primary">
                    🔄 Coba Lagi
                </button>
            </div>
        `;
        ProgressManager.hide('programsContainer');
    }
}

async function loadTestimonialsPreview() {
    const container = document.getElementById('testimonialsContainer');
    if (!container) return;
    
    showLoading(container);
    
    try {
        const response = await callGoogleScript('getTestimoniAktif', {});
        
        if (!response.success) {
            throw new Error(response.message);
        }
        
        const testimonials = response.data.slice(0, 3);
        
        if (testimonials.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                    <h3 style="color: #666; margin-bottom: 1rem;">💬 Belum Ada Testimoni</h3>
                    <p style="color: #999;">Saat ini belum ada testimoni yang tersedia.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = testimonials.map(testimoni => `
            <div class="testimonial-card">
                <div class="testimonial-content">
                    ${testimoni.isi_testimoni}
                </div>
                <div class="testimonial-author">
                    <div class="author-avatar" style="background: #1e3a5f; color: white; width: 50px; height: 50px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.2rem;">
                        ${testimoni.nama.charAt(0)}
                    </div>
                    <div class="author-info">
                        <h4>${testimoni.nama}</h4>
                        <p>${testimoni.asal_sekolah}</p>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Gagal Memuat Testimoni</h3>
                <p style="color: #666; margin-bottom: 1.5rem;">${error.message}</p>
                <button onclick="loadTestimonialsPreview()" class="btn btn-primary">
                    🔄 Coba Lagi
                </button>
            </div>
        `;
    }
}

// ==================== 6. PROGRAM FUNCTIONS ====================

async function loadProgramsData() {
    const container = document.getElementById('programsContainer');
    if (!container) return;
    
    ProgressManager.show('programsContainer', 'Memuat program...');
    
    try {
        ProgressManager.update('programsContainer', 30);
        
        const [programs, promos] = await Promise.all([
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROGRAMS,
                'getProgramAktif',
                {},
                CACHE_CONFIG.DURATIONS.DYNAMIC
            ),
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROMOS,
                'getPromoAktif',
                {},
                CACHE_CONFIG.DURATIONS.SHORT
            )
        ]);
        
        ProgressManager.update('programsContainer', 70);
        
        currentPrograms = programs;
        const activePromos = promos || [];
        
        if (currentPrograms.length === 0) {
            container.innerHTML = `
                <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                    <h3 style="color: #666; margin-bottom: 1rem;">📚 Belum Ada Program</h3>
                    <p style="color: #999;">Saat ini belum ada program yang tersedia.</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = currentPrograms.map(program => {
            const programPromo = activePromos.find(promo => promo.id_program === program.id_program);
            const finalPrice = programPromo ? 
                program.harga * (1 - programPromo.diskon_percent / 100) : 
                program.harga;
            
            const programImage = extractImageFromProgram(program);
            
            return `
    <div class="program-card">
        <div class="program-image-container">
            <img src="${programImage}" 
                 alt="${program.nama_program}" 
                 class="program-image"
                 loading="lazy"
                 onerror="this.onerror=null; this.src='${getDefaultProgramImage(program.jenjang)}'">
            ${programPromo ? `
                <div class="image-badge">🎉 Promo ${programPromo.diskon_percent}%</div>
            ` : ''}
        </div>
        <div class="program-content">
            <h3 class="program-title">${program.nama_program}</h3>
            <div class="program-jenjang">${program.jenjang}</div>
            
            <p class="program-description">${program.deskripsi}</p>
            
            ${programPromo ? `
                <div class="program-promo">
                    🎉 Hemat ${programPromo.diskon_percent}% - 
                    Hanya Rp ${finalPrice.toLocaleString('id-ID')}
                </div>
                <div class="program-price" style="text-decoration: line-through; color: #ef4444; font-size: 1rem;">
                    Rp ${program.harga.toLocaleString('id-ID')}
                </div>
            ` : `
                <div class="program-price">Rp ${program.harga.toLocaleString('id-ID')}</div>
            `}
            
            <div class="program-actions" style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                <button class="btn btn-success" onclick="viewProgramDetail('${program.id_program}')" style="flex: 2;">
                 Lihat Detail
                </button>
                <button class="btn btn-outline" onclick="downloadBrosurProgram('${program.id_program}', '${program.nama_program}')" 
                    style="flex: 1; background: transparent; border: 2px solid #3b82f6; color: #3b82f6;"
                  title="Unduh Brosur">
                📥 Brosur
                </button>
            </div>
        </div>
    </div>
`;
        }).join('');
        
        ProgressManager.update('programsContainer', 100);
        setTimeout(() => ProgressManager.hide('programsContainer'), 500);
        
    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Gagal Memuat Program</h3>
                <p style="color: #666; margin-bottom: 1.5rem;">${error.message}</p>
                <button onclick="loadProgramsData()" class="btn btn-primary">
                    🔄 Coba Lagi
                </button>
            </div>
        `;
        ProgressManager.hide('programsContainer');
    }
}

function viewProgramDetail(programId) {
    window.location.href = `program-detail.html?id=${programId}`;
}

async function loadProgramDetail() {
    const container = document.getElementById('programDetailContainer');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const programId = urlParams.get('id');

    if (!programId) {
        container.innerHTML = `
            <div class="text-center" style="padding: 4rem;">
                <h2 style="color: #dc2626; margin-bottom: 1rem;">Program Tidak Ditemukan</h2>
                <p style="color: #666; margin-bottom: 2rem;">Program yang Anda cari tidak tersedia.</p>
                <a href="program.html" class="btn btn-primary">Kembali ke Daftar Program</a>
            </div>
        `;
        return;
    }

    try {
        const programs = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.PROGRAMS,
            'getProgramAktif',
            {},
            CACHE_CONFIG.DURATIONS.DYNAMIC
        );

        const program = programs.find(p => p.id_program === programId);
        
        if (!program) {
            throw new Error('Program tidak ditemukan');
        }

        const promos = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.PROMOS,
            'getPromoAktif',
            {},
            CACHE_CONFIG.DURATIONS.SHORT
        );

        const programPromo = promos ? promos.find(p => p.id_program === programId) : null;

        const finalPrice = programPromo ? 
            program.harga * (1 - programPromo.diskon_percent / 100) : 
            program.harga;

        container.innerHTML = renderProgramDetailContent(program, programPromo, finalPrice);

    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="padding: 4rem;">
                <h2 style="color: #dc2626; margin-bottom: 1rem;">Gagal Memuat Detail Program</h2>
                <p style="color: #666; margin-bottom: 2rem;">${error.message}</p>
                <a href="program.html" class="btn btn-primary">Kembali ke Daftar Program</a>
            </div>
        `;
    }
}

function renderProgramDetailContent(program, programPromo, finalPrice) {
    const deskripsiLengkap = program.deskripsi_lengkap || program.deskripsi || 'Program belajar berkualitas dengan pengajar profesional dan metode pembelajaran terbaik.';
    const fasilitas = program.fasilitas || 'Modul belajar lengkap,Konsultasi dengan tutor,Try out berkala,Raport perkembangan,Free wifi dan ruang belajar nyaman';
    const sistemPembelajaran = program.sistem_pembelajaran || 'Kombinasi teori, praktik, dan latihan soal dengan pendekatan personalized learning.';
    const durasi = program.durasi || 'Disesuaikan dengan kebutuhan siswa';
    const jadwalContoh = program.jadwal_contoh || 'Flexible, dapat disesuaikan dengan waktu luang siswa';

    return `
        <section class="hero" style="background: linear-gradient(135deg, var(--primary-blue) 0%, var(--primary-purple) 100%);">
            <div class="hero-content">
                <h1 class="hero-title">${program.nama_program}</h1>
                <p class="hero-subtitle">${program.jenjang} - ${program.durasi || 'Program Belajar Terbaik'}</p>
            </div>
        </section>

        <section class="programs" style="padding-top: 3rem;">
            <div class="program-detail-container" style="max-width: 1200px; margin: 0 auto; padding: 0 1.5rem;">
                <div class="program-detail-grid" style="display: grid; grid-template-columns: 1fr 400px; gap: 3rem;">
                    
                    <div class="program-info">
                        <div class="program-image-container" style="border-radius: var(--border-radius); overflow: hidden; margin-bottom: 2rem;">
                            <img src="${extractImageFromProgram(program)}" 
                                 alt="${program.nama_program}" 
                                 class="program-image"
                                 style="width: 100%; height: 300px; object-fit: cover;"
                                 onerror="this.src='${getDefaultProgramImage(program.jenjang)}'">
                            ${programPromo ? `
                                <div class="image-badge" style="position: absolute; top: 20px; right: 20px; background: var(--primary-teal); color: white; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold; font-size: 0.9rem;">
                                    🎉 Promo ${programPromo.diskon_percent}%
                                </div>
                            ` : ''}
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">📖 Tentang Program</h2>
                            <div style="line-height: 1.8; color: var(--medium-gray);">
                                ${deskripsiLengkap}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">🎯 Fasilitas yang Didapat</h2>
                            <div>
                                ${renderFasilitasFromData(fasilitas)}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">📚 Sistem Pembelajaran</h2>
                            <div style="line-height: 1.8; color: var(--medium-gray);">
                                ${sistemPembelajaran}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft);">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">ℹ️ Informasi Program</h2>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                                <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                                    <strong style="color: var(--primary-blue); font-size: 0.9rem;">📅 Durasi:</strong>
                                    <span style="color: var(--medium-gray);">${durasi}</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                                    <strong style="color: var(--primary-blue); font-size: 0.9rem;">🕐 Contoh Jadwal:</strong>
                                    <span style="color: var(--medium-gray);">${jadwalContoh}</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                                    <strong style="color: var(--primary-blue); font-size: 0.9rem;">👥 Jenis Kelas:</strong>
                                    <span style="color: var(--medium-gray);">${program.nama_program.toLowerCase().includes('private') ? 'Private' : 'Group'}</span>
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 0.3rem;">
                                    <strong style="color: var(--primary-blue); font-size: 0.9rem;">🎓 Jenjang:</strong>
                                    <span style="color: var(--medium-gray);">${program.jenjang}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="program-sidebar">
                        <div class="pricing-card" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); position: sticky; top: 100px;">
                            ${programPromo ? `
                                <div style="background: linear-gradient(135deg, var(--primary-purple), var(--purple-light)); color: white; padding: 1rem; border-radius: 10px; margin-bottom: 1.5rem; text-align: center;">
                                    <div style="font-size: 1.5rem; font-weight: bold;">Hemat ${programPromo.diskon_percent}%</div>
                                    <div>Promo berakhir ${new Date(programPromo.tanggal_selesai).toLocaleDateString('id-ID')}</div>
                                </div>
                            ` : ''}

                            <div style="text-align: center; margin-bottom: 2rem;">
                                <div style="font-size: 2rem; font-weight: 700; color: var(--primary-teal);">
                                    Rp ${finalPrice.toLocaleString('id-ID')}
                                </div>
                                ${programPromo ? `
                                    <div style="text-decoration: line-through; color: var(--medium-gray); font-size: 1.2rem;">
                                        Rp ${program.harga.toLocaleString('id-ID')}
                                    </div>
                                ` : ''}
                                <div style="color: var(--medium-gray); font-size: 0.9rem; margin-top: 0.5rem;">
                                    Per ${program.periode || 'bulan'}
                                </div>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 1rem;">
                                ${programPromo ? `
                                    <button class="btn btn-success" onclick="registerWithPromoConfirmation('${program.id_program}', '${program.nama_program}', ${JSON.stringify(programPromo).replace(/"/g, '&quot;')})" style="background: linear-gradient(135deg, #f59e0b, #fbbf24);">
                                          🔥 Daftar dengan Promo ${programPromo.diskon_percent}%
                                    </button>
                                     <button class="btn btn-outline" onclick="openPromoTermsModal(${JSON.stringify(programPromo).replace(/"/g, '&quot;')})" style="border-color: #f59e0b; color: #f59e0b;">
                                        📋 Lihat Syarat Promo
                                     </button>
                                    ` : `
                                   <button class="btn btn-success" onclick="registerForProgram('${program.id_program}', '${program.nama_program}')">
                              🎯 Daftar Sekarang
                              </button>
                                    `}
                                <button class="btn btn-outline" onclick="downloadBrosurProgram('${program.id_program}', '${program.nama_program}')" 
                                    style="padding: 1rem 2rem; font-size: 1.1rem; background: transparent; border: 2px solid var(--primary-blue); color: var(--primary-blue);">
                                    📥 Download Brosur
                                </button>
                                <a href="program.html" class="btn" style="padding: 1rem 2rem; font-size: 1.1rem; background: var(--light-gray); color: var(--dark-gray); text-align: center; text-decoration: none;">
                                    ← Kembali ke Program
                                </a>
                            </div>

                            <div style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--light-gray);">
                                <h4 style="color: var(--dark-gray); margin-bottom: 1rem;">💡 Butuh Bantuan?</h4>
                                <p style="color: var(--medium-gray); font-size: 0.9rem; margin-bottom: 1rem;">
                                    Konsultasi gratis dengan konsultan pendidikan kami
                                </p>
                                <a href="https://wa.me/6285180649460" target="_blank" class="btn" style="background: #25D366; color: white; padding: 0.8rem 1.5rem; text-decoration: none; display: block; text-align: center;">
                                    💬 Chat WhatsApp
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderFasilitasFromData(fasilitasData) {
    let facilitiesArray = [];
    
    if (typeof fasilitasData === 'string') {
        if (fasilitasData.includes('\n')) {
            facilitiesArray = fasilitasData.split('\n').map(item => item.trim());
        } else {
            facilitiesArray = fasilitasData.split(',').map(item => item.trim());
        }
    }
    
    if (facilitiesArray.length === 0) {
        facilitiesArray = [
            'Modul belajar lengkap',
            'Konsultasi dengan tutor',
            'Try out berkala', 
            'Raport perkembangan',
            'Free wifi dan ruang belajar nyaman'
        ];
    }
    
    return `
        <ul style="list-style: none; padding: 0;">
            ${facilitiesArray.map(item => `
                <li style="padding: 0.8rem 0; border-bottom: 1px solid var(--light-gray); display: flex; align-items: center; gap: 1rem;">
                    <span style="color: var(--primary-teal); font-weight: bold; font-size: 1.2rem;">✓</span>
                    ${item}
                </li>
            `).join('')}
        </ul>
    `;
}

// ==================== 7. PROMO FUNCTIONS ====================

async function loadPromosData() {
    const container = document.getElementById('promosContainer');
    const noPromoMessage = document.getElementById('noPromoMessage');
    
    if (!container) return;
    
    showLoading(container);
    
    try {
        const [promos, programs] = await Promise.all([
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROMOS,
                'getPromoAktif',
                {},
                CACHE_CONFIG.DURATIONS.SHORT
            ),
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROGRAMS,
                'getProgramAktif',
                {},
                CACHE_CONFIG.DURATIONS.DYNAMIC
            )
        ]);
        
        currentPromos = promos || [];
        
        if (currentPromos.length === 0) {
            container.classList.add('hidden');
            if (noPromoMessage) noPromoMessage.classList.remove('hidden');
            return;
        }
        
        if (noPromoMessage) noPromoMessage.classList.add('hidden');
        container.classList.remove('hidden');
        
        container.innerHTML = currentPromos.map(promo => {
            const program = programs.find(p => p.id_program === promo.id_program);
            const finalPrice = program ? program.harga * (1 - promo.diskon_percent / 100) : 0;
            const endDate = new Date(promo.tanggal_selesai);
            const today = new Date();
            const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            
            const discountAmount = program ? program.harga - finalPrice : 0;
            
            const promoImage = extractImageForPromo(promo, program);
            
return `
    <div class="promo-card">
        <div class="promo-image-container">
            <img src="${promoImage}" 
                 alt="${promo.nama_promo}" 
                 class="promo-image"
                 loading="lazy"
                 onerror="this.src='${getDefaultPromoImage()}'">
            <div class="image-badge">🔥 PROMO</div>
        </div>
        <div class="promo-content">
            <h3 class="promo-title">${promo.nama_promo}</h3>
            <div class="promo-period">${program ? program.nama_program : 'Program Spesial'}</div>
            
            <p class="promo-description">${promo.deskripsi}</p>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin: 1rem 0; padding: 1rem; background: #e8f5e8; border-radius: 5px;">
                <div>
                    <div style="font-size: 2rem; font-weight: bold; color: #10b981;">
                        ${promo.diskon_percent}%
                    </div>
                    <small>DISCOUNT</small>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 1.2rem; font-weight: bold; color: #10b981;">
                        Hemat Rp ${discountAmount.toLocaleString('id-ID')}
                    </div>
                    <small>Potongan harga</small>
                </div>
            </div>
            
            ${program ? `
                <div style="text-align: center; margin: 1rem 0;">
                    <div style="text-decoration: line-through; color: #ef4444; font-size: 1.1rem;">
                        Rp ${program.harga.toLocaleString('id-ID')}
                    </div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #10b981;">
                        Rp ${finalPrice.toLocaleString('id-ID')}
                    </div>
                </div>
            ` : ''}
            
            <div style="margin: 1rem 0; padding: 0.8rem; background: #fff3e0; border-radius: 5px; text-align: center;">
                <div style="font-weight: bold; color: #f59e0b; margin-bottom: 0.5rem;">
                    ⏳ Promo berakhir dalam ${daysLeft} hari
                </div>
                <small style="color: #666;">
                    Berlaku sampai ${endDate.toLocaleDateString('id-ID', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}
                </small>
            </div>
            
            <div class="promo-actions" style="display: flex; gap: 0.5rem;">
                <button class="btn btn-success" onclick="viewPromoDetail('${promo.id_promo}')" style="flex: 2; background: linear-gradient(135deg, #f59e0b, #fbbf24);">
                🔥 Lihat Detail
                </button>
                <button class="btn btn-outline" onclick="downloadBrosurPromo('${promo.id_promo}', '${promo.nama_promo}')" 
                style="flex: 1; background: transparent; border: 2px solid #f59e0b; color: #f59e0b;"
                     title="Unduh Brosur Promo">
                📥 Brosur
                </button>
            </div>
        </div>
    </div>
`;
        }).join('');
    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Gagal Memuat Promo</h3>
                <p style="color: #666; margin-bottom: 1.5rem;">${error.message}</p>
                <button onclick="loadPromosData()" class="btn btn-primary">
                    🔄 Coba Lagi
                </button>
            </div>
        `;
    }
}

// Fungsi untuk daftar dengan konfirmasi promo
function registerWithPromoConfirmation(programId, programName, promoData) {
    openPromoTermsModal(promoData);
    
    const confirmButton = document.querySelector('#promoTermsModal .btn-success');
    if (confirmButton) {
        confirmButton.replaceWith(confirmButton.cloneNode(true));
        
        const newButton = document.querySelector('#promoTermsModal .btn-success');
        newButton.onclick = function() {
            closePromoTermsModal();
            setTimeout(() => {
                registerForProgram(programId, programName);
            }, 300);
        };
        newButton.innerHTML = '🎯 Daftar Sekarang dengan Promo';
    }
}

// Fungsi untuk buka modal syarat & ketentuan
function openPromoTermsModal(promoData) {
    currentProgramPromo = promoData;
    const modal = document.getElementById('promoTermsModal');
    const content = document.getElementById('promoTermsContent');
    
    if (!modal || !content) return;
    
    content.innerHTML = renderPromoTermsContent(promoData);
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

// Fungsi untuk tutup modal
function closePromoTermsModal() {
    const modal = document.getElementById('promoTermsModal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// Fungsi untuk render content syarat & ketentuan
function renderPromoTermsContent(promoData) {
    const endDate = new Date(promoData.tanggal_selesai);
    const today = new Date();
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
    
    const syaratKetentuan = promoData.syarat_ketentuan || 
        'Promo berlaku untuk pendaftaran baru, Tidak dapat digabung dengan promo lain, Berlaku sampai tanggal yang ditentukan, Syarat dan ketentuan dapat berubah sewaktu-waktu';
    
    const caraKlaim = promoData.cara_klaim || 
        'Daftar melalui website atau hubungi admin, Mention kode promo saat pendaftaran, Promo akan secara otomatis diterapkan, Dapatkan konfirmasi dari admin';
    
    return `
        <div style="margin-bottom: 1.5rem;">
            <div style="background: linear-gradient(135deg, #fef3c7, #fed7aa); padding: 1rem; border-radius: 10px; margin-bottom: 1rem;">
                <div style="text-align: center;">
                    <div style="font-size: 1.5rem; font-weight: bold; color: #ea580c; margin-bottom: 0.5rem;">
                        🎉 ${promoData.diskon_percent}% DISCOUNT
                    </div>
                    <div style="color: #ea580c; font-size: 0.9rem;">
                        Berlaku ${daysLeft} hari lagi • Sampai ${endDate.toLocaleDateString('id-ID')}
                    </div>
                </div>
            </div>
        </div>

        <div style="margin-bottom: 1.5rem;">
            <h3 style="color: var(--dark-gray); margin-bottom: 0.8rem; font-size: 1.1rem;">📝 Syarat & Ketentuan</h3>
            <div style="background: #f8fafc; padding: 1rem; border-radius: 8px;">
                ${renderSyaratList(syaratKetentuan)}
            </div>
        </div>

        <div style="margin-bottom: 1.5rem;">
            <h3 style="color: var(--dark-gray); margin-bottom: 0.8rem; font-size: 1.1rem;">🎁 Cara Klaim Promo</h3>
            <div style="background: #f0f9ff; padding: 1rem; border-radius: 8px;">
                ${renderCaraKlaimList(caraKlaim)}
            </div>
        </div>

        <div style="background: #fef2f2; padding: 1rem; border-radius: 8px; border-left: 4px solid #dc2626;">
            <h4 style="color: #dc2626; margin-bottom: 0.5rem; font-size: 1rem;">⚠️ Penting!</h4>
            <p style="color: #dc2626; font-size: 0.9rem; margin: 0;">
                Promo ini terbatas dan dapat berubah sewaktu-waktu. Pastikan untuk mendaftar sebelum promo berakhir.
            </p>
        </div>
    `;
}

// Helper functions
function renderSyaratList(syaratData) {
    let syaratArray = [];
    
    if (typeof syaratData === 'string') {
        if (syaratData.includes('\n')) {
            syaratArray = syaratData.split('\n').map(item => item.trim());
        } else {
            syaratArray = syaratData.split(',').map(item => item.trim());
        }
    }
    
    if (syaratArray.length === 0) {
        syaratArray = [
            'Promo berlaku untuk pendaftaran baru',
            'Tidak dapat digabung dengan promo lain',
            'Berlaku sampai tanggal yang ditentukan',
            'Syarat dan ketentuan dapat berubah sewaktu-waktu'
        ];
    }
    
    return `
        <ul style="list-style: none; padding: 0; margin: 0;">
            ${syaratArray.map(item => `
                <li style="padding: 0.5rem 0; display: flex; align-items: flex-start; gap: 0.8rem;">
                    <span style="color: #dc2626; font-weight: bold; flex-shrink: 0;">•</span>
                    <span style="color: var(--medium-gray); font-size: 0.9rem; line-height: 1.4;">${item}</span>
                </li>
            `).join('')}
        </ul>
    `;
}

function renderCaraKlaimList(caraData) {
    let caraArray = [];
    
    if (typeof caraData === 'string') {
        if (caraData.includes('\n')) {
            caraArray = caraData.split('\n').map(item => item.trim());
        } else {
            caraArray = caraData.split(',').map(item => item.trim());
        }
    }
    
    if (caraArray.length === 0) {
        caraArray = [
            'Daftar melalui website atau hubungi admin',
            'Mention kode promo saat pendaftaran',
            'Promo akan secara otomatis diterapkan',
            'Dapatkan konfirmasi dari admin'
        ];
    }
    
    return `
        <div style="display: flex; flex-direction: column; gap: 1rem;">
            ${caraArray.map((item, index) => `
                <div style="display: flex; gap: 0.8rem; align-items: flex-start;">
                    <div style="background: var(--primary-teal); color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 0.8rem; flex-shrink: 0;">
                        ${index + 1}
                    </div>
                    <span style="color: var(--medium-gray); font-size: 0.9rem; line-height: 1.4; flex: 1;">${item}</span>
                </div>
            `).join('')}
        </div>
    `;
}

function viewPromoDetail(promoId) {
    window.location.href = `promo-detail.html?id=${promoId}`;
}

async function loadPromoDetail() {
    const container = document.getElementById('promoDetailContainer');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const promoId = urlParams.get('id');

    if (!promoId) {
        container.innerHTML = `
            <div class="text-center" style="padding: 4rem;">
                <h2 style="color: #dc2626; margin-bottom: 1rem;">Promo Tidak Ditemukan</h2>
                <p style="color: #666; margin-bottom: 2rem;">Promo yang Anda cari tidak tersedia.</p>
                <a href="promo.html" class="btn btn-primary">Kembali ke Daftar Promo</a>
            </div>
        `;
        return;
    }

    try {
        const [promos, programs] = await Promise.all([
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROMOS,
                'getPromoAktif',
                {},
                CACHE_CONFIG.DURATIONS.SHORT
            ),
            CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROGRAMS,
                'getProgramAktif',
                {},
                CACHE_CONFIG.DURATIONS.DYNAMIC
            )
        ]);

        const promo = promos.find(p => p.id_promo === promoId);
        
        if (!promo) {
            throw new Error('Promo tidak ditemukan');
        }

        const program = programs.find(p => p.id_program === promo.id_program);

        container.innerHTML = renderPromoDetailContent(promo, program);

    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="padding: 4rem;">
                <h2 style="color: #dc2626; margin-bottom: 1rem;">Gagal Memuat Detail Promo</h2>
                <p style="color: #666; margin-bottom: 2rem;">${error.message}</p>
                <a href="promo.html" class="btn btn-primary">Kembali ke Daftar Promo</a>
            </div>
        `;
    }
}

function renderPromoDetailContent(promo, program) {
    const deskripsiPromo = promo.deskripsi_lengkap || promo.deskripsi || 'Promo spesial dengan penawaran terbatas. Jangan lewatkan kesempatan ini!';
    const syaratKetentuan = promo.syarat_ketentuan || 'Promo berlaku untuk pendaftaran baru, Tidak dapat digabung dengan promo lain, Berlaku sampai tanggal yang ditentukan';
    const caraKlaim = promo.cara_klaim || 'Daftar melalui website atau hubungi admin, Mention kode promo saat pendaftaran, Promo akan secara otomatis diterapkan';
    
    const finalPrice = program ? program.harga * (1 - promo.diskon_percent / 100) : 0;
    const discountAmount = program ? program.harga - finalPrice : 0;

    const endDate = new Date(promo.tanggal_selesai);
    const today = new Date();
    const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    return `
        <section class="hero" style="background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%);">
            <div class="hero-content">
                <h1 class="hero-title">${promo.nama_promo}</h1>
                <p class="hero-subtitle">🔥 Promo Spesial Terbatas</p>
            </div>
        </section>

        <section class="programs" style="padding-top: 3rem;">
            <div class="program-detail-container" style="max-width: 1200px; margin: 0 auto; padding: 0 1.5rem;">
                <div class="program-detail-grid" style="display: grid; grid-template-columns: 1fr 400px; gap: 3rem;">
                    
                    <div class="program-info">
                        <div class="program-image-container" style="border-radius: var(--border-radius); overflow: hidden; margin-bottom: 2rem;">
                            <img src="${extractImageForPromo(promo, program)}" 
                                 alt="${promo.nama_promo}" 
                                 class="program-image"
                                 style="width: 100%; height: 300px; object-fit: cover;"
                                 onerror="this.src='${getDefaultPromoImage()}'">
                            <div class="image-badge" style="position: absolute; top: 20px; right: 20px; background: #dc2626; color: white; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold; font-size: 0.9rem;">
                                🔥 PROMO TERBATAS
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                                <h2 style="color: var(--dark-gray); margin: 0; font-family: 'Plus Jakarta Sans';">${promo.nama_promo}</h2>
                                <div style="background: linear-gradient(135deg, #f59e0b, #fbbf24); color: white; padding: 0.5rem 1rem; border-radius: 20px; font-weight: bold;">
                                    ${promo.diskon_percent}% OFF
                                </div>
                            </div>
                            
                            <div style="color: var(--medium-gray); line-height: 1.7; margin-bottom: 1.5rem;">
                                ${deskripsiPromo}
                            </div>

                            ${program ? `
                                <div style="background: #f0f9ff; padding: 1.5rem; border-radius: 10px; border-left: 4px solid var(--primary-blue);">
                                    <h4 style="color: var(--primary-blue); margin-bottom: 0.5rem;">📚 Program Terkait</h4>
                                    <p style="color: var(--dark-gray); margin: 0; font-weight: 500;">${program.nama_program} - ${program.jenjang}</p>
                                </div>
                            ` : ''}
                        </div>

                        <div class="detail-section" style="background: linear-gradient(135deg, #fff7ed, #fed7aa); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem; border: 2px solid #f59e0b;">
                            <h3 style="color: #ea580c; margin-bottom: 1rem; text-align: center;">⏰ Promo Berakhir Dalam</h3>
                            <div style="text-align: center;">
                                <div style="font-size: 2.5rem; font-weight: bold; color: #ea580c; margin-bottom: 0.5rem;">
                                    ${daysLeft} Hari
                                </div>
                                <div style="color: #ea580c; font-size: 0.9rem;">
                                    Sampai ${endDate.toLocaleDateString('id-ID', { 
                                        weekday: 'long', 
                                        year: 'numeric', 
                                        month: 'long', 
                                        day: 'numeric' 
                                    })}
                                </div>
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">📋 Syarat & Ketentuan</h2>
                            <div>
                                ${renderSyaratKetentuan(syaratKetentuan)}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft);">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">🎁 Cara Klaim Promo</h2>
                            <div>
                                ${renderCaraKlaim(caraKlaim)}
                            </div>
                        </div>
                    </div>

                    <div class="program-sidebar">
                        <div class="pricing-card" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); position: sticky; top: 100px; border: 2px solid #f59e0b;">
                            <div style="background: linear-gradient(135deg, #dc2626, #ef4444); color: white; padding: 1rem; border-radius: 10px; margin-bottom: 1.5rem; text-align: center;">
                                <div style="font-size: 1.8rem; font-weight: bold;">HEMAT ${promo.diskon_percent}%</div>
                                <div>Rp ${discountAmount.toLocaleString('id-ID')}</div>
                            </div>

                            ${program ? `
                                <div style="text-align: center; margin-bottom: 2rem;">
                                    <div style="text-decoration: line-through; color: var(--medium-gray); font-size: 1.2rem; margin-bottom: 0.5rem;">
                                        Rp ${program.harga.toLocaleString('id-ID')}
                                    </div>
                                    <div style="font-size: 2.5rem; font-weight: 700; color: #dc2626;">
                                        Rp ${finalPrice.toLocaleString('id-ID')}
                                    </div>
                                    <div style="color: var(--medium-gray); font-size: 0.9rem; margin-top: 0.5rem;">
                                        Per ${program.periode || 'bulan'}
                                    </div>
                                </div>
                            ` : `
                                <div style="text-align: center; margin-bottom: 2rem;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #dc2626;">
                                        Diskon ${promo.diskon_percent}%
                                    </div>
                                    <div style="color: var(--medium-gray); font-size: 0.9rem; margin-top: 0.5rem;">
                                        Untuk program terpilih
                                    </div>
                                </div>
                            `}

                            <div style="display: flex; flex-direction: column; gap: 1rem;">
                                ${program ? `
                                    <button class="btn btn-success" onclick="registerForProgram('${program.id_program}', '${program.nama_program}')" style="padding: 1rem 2rem; font-size: 1.1rem; background: linear-gradient(135deg, #dc2626, #ef4444);">
                                        🎯 Daftar Sekarang
                                    </button>
                                ` : `
                                    <button class="btn btn-success" onclick="location.href='program.html'" style="padding: 1rem 2rem; font-size: 1.1rem; background: linear-gradient(135deg, #dc2626, #ef4444);">
                                        🎯 Lihat Program
                                    </button>
                                `}
                                
                                <button class="btn btn-outline" onclick="downloadBrosurPromo('${promo.id_promo}', '${promo.nama_promo}')" 
                                    style="padding: 1rem 2rem; font-size: 1.1rem; background: transparent; border: 2px solid #f59e0b; color: #f59e0b;">
                                    📥 Download Brosur Promo
                                </button>
                                
                                <a href="promo.html" class="btn" style="padding: 1rem 2rem; font-size: 1.1rem; background: var(--light-gray); color: var(--dark-gray); text-align: center; text-decoration: none;">
                                    ← Kembali ke Promo
                                </a>
                            </div>

                            <div style="margin-top: 2rem; padding-top: 2rem; border-top: 1px solid var(--light-gray);">
                                <h4 style="color: var(--dark-gray); margin-bottom: 1rem;">💡 Butuh Bantuan?</h4>
                                <p style="color: var(--medium-gray); font-size: 0.9rem; margin-bottom: 1rem;">
                                    Konsultasi gratis dengan konsultan kami
                                </p>
                                <a href="https://wa.me/6285180649460" target="_blank" class="btn" style="background: #25D366; color: white; padding: 0.8rem 1.5rem; text-decoration: none; display: block; text-align: center;">
                                    💬 Chat WhatsApp
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderSyaratKetentuan(syaratData) {
    let syaratArray = [];
    
    if (typeof syaratData === 'string') {
        if (syaratData.includes('\n')) {
            syaratArray = syaratData.split('\n').map(item => item.trim());
        } else {
            syaratArray = syaratData.split(',').map(item => item.trim());
        }
    }
    
    if (syaratArray.length === 0) {
        syaratArray = [
            'Promo berlaku untuk pendaftaran baru',
            'Tidak dapat digabung dengan promo lain',
            'Berlaku sampai tanggal yang ditentukan',
            'Syarat dan ketentuan dapat berubah sewaktu-waktu'
        ];
    }
    
    return `
        <ul style="list-style: none; padding: 0;">
            ${syaratArray.map(item => `
                <li style="padding: 0.8rem 0; border-bottom: 1px solid var(--light-gray); display: flex; align-items: center; gap: 1rem;">
                    <span style="color: #dc2626; font-weight: bold; font-size: 1.2rem;">!</span>
                    ${item}
                </li>
            `).join('')}
        </ul>
    `;
}

function renderCaraKlaim(caraData) {
    let caraArray = [];
    
    if (typeof caraData === 'string') {
        if (caraData.includes('\n')) {
            caraArray = caraData.split('\n').map(item => item.trim());
        } else {
            caraArray = caraData.split(',').map(item => item.trim());
        }
    }
    
    if (caraArray.length === 0) {
        caraArray = [
            'Daftar melalui website atau hubungi admin',
            'Mention kode promo saat pendaftaran',
            'Promo akan secara otomatis diterapkan',
            'Dapatkan konfirmasi dari admin'
        ];
    }
    
    return `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
            ${caraArray.map((item, index) => `
                <div style="display: flex; gap: 1rem; align-items: flex-start;">
                    <div style="background: #10b981; color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">
                        ${index + 1}
                    </div>
                    <div style="line-height: 1.6; color: var(--medium-gray); flex: 1;">
                        ${item}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ==================== 8. TESTIMONIAL FUNCTIONS ====================

async function loadTestimonialsData() {
    const container = document.getElementById('testimonialsContainer');
    const noTestimonialsMessage = document.getElementById('noTestimonialsMessage');
    
    if (!container) return;
    
    showLoading(container);
    
    try {
        const response = await callGoogleScript('getTestimoniAktif', {});
        
        if (!response.success) {
            throw new Error(response.message);
        }
        
        const testimonials = response.data;
        
        if (testimonials.length === 0) {
            container.classList.add('hidden');
            if (noTestimonialsMessage) noTestimonialsMessage.classList.remove('hidden');
            return;
        }
        
        if (noTestimonialsMessage) noTestimonialsMessage.classList.add('hidden');
        container.classList.remove('hidden');
        
        container.innerHTML = testimonials.map(testimoni => `
            <div class="testimonial-card" style="position: relative;">
                <div class="testimonial-content">
                    "${testimoni.isi_testimoni}"
                </div>
                <div class="testimonial-author">
                    <div class="author-avatar" style="background: #1e3a5f; color: white; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 1.5rem;">
                        ${testimoni.nama.charAt(0)}
                    </div>
                    <div class="author-info">
                        <h4>${testimoni.nama}</h4>
                        <p>${testimoni.asal_sekolah}</p>
                        <div style="color: #ffc107; font-size: 0.9rem; margin-top: 0.2rem;">
                            ⭐⭐⭐⭐⭐
                        </div>
                    </div>
                </div>
                <div style="position: absolute; top: 10px; right: 10px; color: #e0e0e0; font-size: 3rem;">
                    ”
                </div>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Gagal Memuat Testimoni</h3>
                <p style="color: #666; margin-bottom: 1.5rem;">${error.message}</p>
                <button onclick="loadTestimonialsData()" class="btn btn-primary">
                    🔄 Coba Lagi
                </button>
            </div>
        `;
    }
}

// ==================== 9. KARIR FUNCTIONS ====================

async function loadKarirData() {
    const container = document.getElementById('karirContainer');
    if (!container) {
        console.error('❌ Container karir tidak ditemukan');
        return;
    }
    
    showLoading(container);
    
    try {
        console.log('🔄 Memuat data karir...');
        const response = await callGoogleScript('getKarirAktif', {});
        
        if (!response.success) {
            console.error('❌ Response tidak success:', response.message);
            throw new Error(response.message);
        }
        
        const karirList = response.data || [];
        console.log('🎯 Jumlah karir ditemukan:', karirList.length);
        
        if (karirList.length === 0) {
            console.log('ℹ️ Tidak ada karir aktif');
            container.innerHTML = `
                <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                    <h3 style="color: #666; margin-bottom: 1rem;">💼 Belum Ada Lowongan</h3>
                    <p style="color: #999;">Saat ini belum ada lowongan pekerjaan yang tersedia.</p>
                    <p style="color: #999;">Silakan cek kembali di lain waktu atau hubungi kami untuk informasi lebih lanjut.</p>
                </div>
            `;
            return;
        }
        
        console.log('🎨 Mulai render karir list...');
        container.innerHTML = karirList.map(karir => {
            const deadline = new Date(karir.tanggal_selesai);
            const today = new Date();
            const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
            
            const karirImage = extractImageForKarir(karir);
            
            return `
                <div class="program-card">
                    <div class="program-image-container">
                        <img src="${karirImage}" 
                             alt="${karir.judul_lowongan}" 
                             class="program-image"
                             loading="lazy"
                             onerror="this.src='${getDefaultKarirImage()}'">
                        <div class="image-badge">💼 ${karir.jenis_pekerjaan || 'Tutor'}</div>
                    </div>
                    <div class="program-content">
                        <h3 class="program-title">${karir.judul_lowongan || 'Lowongan Tutor'}</h3>
                        <div class="program-jenjang">${karir.departemen || 'Pendidikan'}</div>
                        
                        <p class="program-description">${karir.deskripsi_singkat || karir.deskripsi_lowongan?.substring(0, 100) + '...' || 'Bergabunglah dengan tim pengajar profesional Smart Catalyst'}</p>
                        
                        <div style="margin: 1rem 0; padding: 1rem; background: #f0f9ff; border-radius: 5px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
                                <strong style="color: var(--primary-blue);">📍 Lokasi:</strong>
                                <span style="color: var(--medium-gray);">${karir.lokasi || 'Pringsewu, Lampung'}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <strong style="color: var(--primary-blue);">🕒 Tipe:</strong>
                                <span style="color: var(--medium-gray);">${karir.jenis_pekerjaan || 'Part-Time'}</span>
                            </div>
                        </div>
                        
                        <div style="margin: 1rem 0; padding: 0.8rem; background: ${daysLeft <= 7 ? '#fef2f2' : '#fff7ed'}; border-radius: 5px; text-align: center;">
                            <div style="font-weight: bold; color: ${daysLeft <= 7 ? '#dc2626' : '#f59e0b'};">
                                ⏳ ${daysLeft > 0 ? `Tutup dalam ${daysLeft} hari` : 'Segera tutup'}
                            </div>
                            <small style="color: #666;">
                                Batas: ${deadline.toLocaleDateString('id-ID')}
                            </small>
                        </div>
                        
                        <div class="program-actions" style="display: flex; gap: 0.5rem;">
                            <button class="btn btn-success" onclick="viewKarirDetail('${karir.id_karir}')" style="flex: 2;">
                                📋 Lihat Detail
                            </button>
                            <button class="btn btn-outline" onclick="applyForKarir('${karir.id_karir}', '${karir.judul_lowongan}')" 
                                style="flex: 1; background: transparent; border: 2px solid var(--primary-teal); color: var(--primary-teal);">
                                ✉️ Lamar
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
        console.log('✅ Data karir berhasil dimuat dan dirender');
        
    } catch (error) {
        console.error('❌ Error loading karir:', error);
        container.innerHTML = `
            <div class="text-center" style="grid-column: 1 / -1; padding: 3rem;">
                <h3 style="color: #dc2626; margin-bottom: 1rem;">❌ Gagal Memuat Lowongan</h3>
                <p style="color: #666; margin-bottom: 1.5rem;">${error.message}</p>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <button onclick="loadKarirData()" class="btn btn-primary">
                        🔄 Coba Lagi
                    </button>
                    <a href="https://wa.me/6285180649460" target="_blank" class="btn btn-success">
                        💬 Tanya Admin
                    </a>
                </div>
            </div>
        `;
    }
}

async function loadKarirDetail() {
    const container = document.getElementById('karirDetailContainer');
    if (!container) return;

    const urlParams = new URLSearchParams(window.location.search);
    const karirId = urlParams.get('id');

    if (!karirId) {
        container.innerHTML = `
            <div class="text-center" style="padding: 4rem;">
                <h2 style="color: #dc2626; margin-bottom: 1rem;">Lowongan Tidak Ditemukan</h2>
                <p style="color: #666; margin-bottom: 2rem;">Lowongan yang Anda cari tidak tersedia.</p>
                <a href="karir.html" class="btn btn-primary">Kembali ke Lowongan</a>
            </div>
        `;
        return;
    }

    try {
        console.log('🔄 Memuat detail karir:', karirId);
        const response = await callGoogleScript('getKarirDetail', { id: karirId });
        
        if (!response.success) {
            throw new Error(response.message);
        }

        const karir = response.data;
        
        if (!karir) {
            throw new Error('Lowongan tidak ditemukan');
        }

        container.innerHTML = renderKarirDetailContent(karir);
        console.log('✅ Detail karir berhasil dimuat');

    } catch (error) {
        console.error('❌ Error loading karir detail:', error);
        container.innerHTML = `
            <div class="text-center" style="padding: 4rem;">
                <h2 style="color: #dc2626; margin-bottom: 1rem;">Gagal Memuat Detail Lowongan</h2>
                <p style="color: #666; margin-bottom: 2rem;">${error.message}</p>
                <div style="display: flex; gap: 1rem; justify-content: center;">
                    <a href="karir.html" class="btn btn-primary">Kembali ke Lowongan</a>
                    <button onclick="loadKarirDetail()" class="btn btn-success">
                        🔄 Coba Lagi
                    </button>
                </div>
            </div>
        `;
    }
}

function renderKarirDetailContent(karir) {
    const deadline = new Date(karir.tanggal_selesai);
    const today = new Date();
    const daysLeft = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
    
    const deskripsiLengkap = karir.deskripsi_lowongan || karir.deskripsi_singkat || 'Lowongan pekerjaan sebagai tutor profesional di Smart Catalyst.';
    const kualifikasi = karir.kualifikasi || 'Pendidikan minimal S1, Pengalaman mengajar minimal 1 tahun, Menguasai materi pelajaran dengan baik';
    const tanggungJawab = karir.tanggung_jawab || 'Mengajar siswa sesuai jadwal, Membuat rencana pembelajaran, Mengevaluasi perkembangan siswa';
    const benefit = karir.benefit || 'Gaji kompetitif, Jam kerja fleksibel, Pelatihan pengembangan diri, Lingkungan kerja yang supportive';

    return `
        <section class="hero" style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);">
            <div class="hero-content">
                <h1 class="hero-title">${karir.judul_lowongan}</h1>
                <p class="hero-subtitle">${karir.departemen || 'Departemen Pendidikan'} • ${karir.lokasi || 'Pringsewu, Lampung'}</p>
            </div>
        </section>

        <section class="programs" style="padding-top: 3rem;">
            <div class="program-detail-container" style="max-width: 1200px; margin: 0 auto; padding: 0 1.5rem;">
                <div class="program-detail-grid" style="display: grid; grid-template-columns: 1fr 400px; gap: 3rem;">
                    
                    <div class="program-info">
                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">📖 Deskripsi Pekerjaan</h2>
                            <div style="line-height: 1.8; color: var(--medium-gray);">
                                ${deskripsiLengkap}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">🎯 Kualifikasi & Persyaratan</h2>
                            <div style="line-height: 1.8; color: var(--medium-gray);">
                                ${renderListFromText(kualifikasi)}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">🎯 Tanggung Jawab</h2>
                            <div style="line-height: 1.8; color: var(--medium-gray);">
                                ${renderListFromText(tanggungJawab)}
                            </div>
                        </div>

                        <div class="detail-section" style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                            <h2 style="color: var(--dark-gray); margin-bottom: 1.5rem; font-family: 'Plus Jakarta Sans';">🎁 Benefit & Fasilitas</h2>
                            <div style="line-height: 1.8; color: var(--medium-gray);">
                                ${renderListFromText(benefit)}
                            </div>
                        </div>
                    </div>

                    <div class="program-sidebar">
                        <div style="position: sticky; top: 100px;">
                            <div style="background: var(--white); padding: 2rem; border-radius: var(--border-radius); box-shadow: var(--shadow-soft); margin-bottom: 2rem;">
                                <h3 style="color: var(--dark-gray); margin-bottom: 1.5rem; text-align: center;">📋 Info Lowongan</h3>
                                
                                <div style="margin-bottom: 1.5rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--light-gray);">
                                        <strong style="color: var(--primary-blue);">💼 Posisi:</strong>
                                        <span style="color: var(--medium-gray);">${karir.judul_lowongan}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--light-gray);">
                                        <strong style="color: var(--primary-blue);">🏢 Departemen:</strong>
                                        <span style="color: var(--medium-gray);">${karir.departemen || 'Pendidikan'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--light-gray);">
                                        <strong style="color: var(--primary-blue);">📍 Lokasi:</strong>
                                        <span style="color: var(--medium-gray);">${karir.lokasi || 'Pringsewu, Lampung'}</span>
                                    </div>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--light-gray);">
                                        <strong style="color: var(--primary-blue);">🕒 Tipe:</strong>
                                        <span style="color: var(--medium-gray);">${karir.jenis_pekerjaan}</span>
                                    </div>
                                </div>

                                <div style="background: ${daysLeft <= 7 ? '#fef2f2' : '#fff7ed'}; padding: 1rem; border-radius: 8px; text-align: center; margin-bottom: 1.5rem;">
                                    <div style="font-weight: bold; color: ${daysLeft <= 7 ? '#dc2626' : '#f59e0b'}; margin-bottom: 0.5rem;">
                                        ⏳ ${daysLeft > 0 ? `Tutup dalam ${daysLeft} hari` : 'Segera tutup'}
                                    </div>
                                    <small style="color: #666;">
                                        Batas: ${deadline.toLocaleDateString('id-ID')}
                                    </small>
                                </div>

                                <button onclick="applyForKarir('${karir.id_karir}', '${karir.judul_lowongan}')" 
                                        class="btn btn-success btn-block"
                                        style="padding: 1rem 2rem; font-size: 1.1rem; width: 100%;">
                                    📨 Lamar Pekerjaan Ini
                                </button>
                            </div>

                            <a href="karir.html" class="btn btn-outline btn-block" 
                               style="padding: 1rem 2rem; text-align: center; display: block; text-decoration: none;">
                                ← Kembali ke Lowongan
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function extractImageForKarir(karir) {
    console.log('🖼️ Mencari gambar untuk karir:', karir.judul_lowongan);
    
    const possibleImageFields = [
        karir.gambar,
        karir.N,
        karir.O,
        karir.P,
        karir.image,
        karir.foto,
        karir.photo,
        karir.img,
        karir.picture,
        karir.url_gambar,
        karir.link_gambar,
        karir.gambar_url,
        ...Object.values(karir).filter(val => 
            typeof val === 'string' && 
            val.includes('http') && 
            (val.includes('drive.google.com') || val.includes('.jpg') || val.includes('.png') || val.includes('.jpeg'))
        )
    ];
    
    for (const imageUrl of possibleImageFields) {
        if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '' && imageUrl.includes('http')) {
            console.log('✅ Found karir image URL:', imageUrl);
            
            if (imageUrl.includes('drive.google.com')) {
                const convertedUrl = convertGoogleDriveLink(imageUrl);
                console.log('🔄 Converted Google Drive URL:', convertedUrl);
                return convertedUrl;
            }
            
            return imageUrl;
        }
    }
    
    console.log('❌ No image URL found, using default');
    return getDefaultKarirImage();
}

function getDefaultKarirImage() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiM4QjVDNEYiLz4KPHRleHQgeD0iMjAwIiB5PSIxMDAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIj5Mb3dvbmdhbiBLZXJqYTwvdGV4dD4KPC9zdmc+';
}

function renderListFromText(text) {
    if (!text) return '<p>- Tidak ada informasi</p>';
    
    const items = text.split(',').map(item => item.trim()).filter(item => item);
    
    if (items.length === 0) return '<p>- Tidak ada informasi</p>';
    
    return items.map(item => `<p>• ${item}</p>`).join('');
}

function viewKarirDetail(karirId) {
    window.location.href = `karir-detail.html?id=${karirId}`;
}

function applyForKarir(karirId, karirName) {
    localStorage.setItem('selectedKarirId', karirId);
    localStorage.setItem('selectedKarirName', karirName);
    window.location.href = 'registrasi-tutor.html';
}

function autoSelectKarirInForm() {
    const karirId = localStorage.getItem('selectedKarirId');
    const karirName = localStorage.getItem('selectedKarirName');
    
    if (karirId && karirName) {
        const feedbackElement = document.getElementById('autoSelectFeedback');
        const karirNameElement = document.getElementById('selectedKarirName');
        
        if (feedbackElement && karirNameElement) {
            feedbackElement.classList.remove('hidden');
            karirNameElement.textContent = karirName;
        }
    }
}

// ==================== 10. REGISTRATION FUNCTIONS ====================

function registerForProgram(programId, programName) {
    sessionStorage.setItem('selectedProgramId', programId);
    sessionStorage.setItem('selectedProgramName', programName);
    window.location.href = `registrasi.html?program=${programId}`;
}

function initializeRegistrationForm() {
    const programSelect = document.getElementById('programSelect');
    const privateForm = document.getElementById('privateForm');
    const groupForm = document.getElementById('groupForm');
    const initialMessage = document.getElementById('initialMessage');
    
    if (programSelect) {
        loadProgramsForRegistration();
        
        programSelect.addEventListener('change', function() {
            const selectedProgram = currentPrograms.find(p => p.id_program === this.value);
            
            if (selectedProgram) {
                const isPrivate = selectedProgram.nama_program.toLowerCase().includes('private');
                
                if (initialMessage) initialMessage.classList.add('hidden');
                
                if (isPrivate) {
                    privateForm.classList.remove('hidden');
                    groupForm.classList.add('hidden');
                } else {
                    privateForm.classList.add('hidden');
                    groupForm.classList.remove('hidden');
                }
            } else {
                if (initialMessage) initialMessage.classList.remove('hidden');
                privateForm.classList.add('hidden');
                groupForm.classList.add('hidden');
            }
        });
        
        autoSelectProgramFromURL();
    }
    
    const privateFormElement = document.getElementById('privateRegistrationForm');
    const groupFormElement = document.getElementById('groupRegistrationForm');
    
    if (privateFormElement) {
        privateFormElement.addEventListener('submit', handlePrivateRegistration);
    }
    
    if (groupFormElement) {
        groupFormElement.addEventListener('submit', handleGroupRegistration);
    }
    
    setupClassOptions();
    
    const checkboxes = document.querySelectorAll('input[name="jadwal_hari"]');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const checkedCount = document.querySelectorAll('input[name="jadwal_hari"]:checked').length;
            if (checkedCount > 3) {
                showError('Maksimal 3 hari belajar yang dapat dipilih');
                this.checked = false;
            }
        });
    });
}

function autoSelectProgramFromURL() {
    const programSelect = document.getElementById('programSelect');
    const feedbackElement = document.getElementById('autoSelectFeedback');
    const programNameElement = document.getElementById('selectedProgramName');
    
    if (!programSelect) return;
    
    const urlParams = new URLSearchParams(window.location.search);
    const programParam = urlParams.get('program');
    const sessionProgramId = sessionStorage.getItem('selectedProgramId');
    const sessionProgramName = sessionStorage.getItem('selectedProgramName');
    
    const programIdToSelect = programParam || sessionProgramId;
    const programNameToShow = sessionProgramName;
    
    if (programIdToSelect && programSelect) {
        let attempts = 0;
        const maxAttempts = 30;
        
        const trySelectProgram = setInterval(() => {
            attempts++;
            
            if (programSelect.options.length > 1) {
                programSelect.value = programIdToSelect;
                
                if (feedbackElement && programNameToShow) {
                    programNameElement.textContent = programNameToShow;
                    feedbackElement.classList.remove('hidden');
                }
                
                const changeEvent = new Event('change');
                programSelect.dispatchEvent(changeEvent);
                
                setTimeout(() => {
                    const formElement = document.getElementById('privateForm') || 
                                      document.getElementById('groupForm');
                    if (formElement) {
                        formElement.scrollIntoView({ 
                            behavior: 'smooth', 
                            block: 'start' 
                        });
                    }
                }, 500);
                
                sessionStorage.removeItem('selectedProgramId');
                sessionStorage.removeItem('selectedProgramName');
                
                clearInterval(trySelectProgram);
            }
            
            if (attempts >= maxAttempts) {
                clearInterval(trySelectProgram);
                console.log('Gagal auto-select program: timeout');
            }
        }, 100);
    }
}

async function loadProgramsForRegistration() {
    const programSelect = document.getElementById('programSelect');
    if (!programSelect) return;
    
    try {
        const programs = await CacheManager.loadWithCache(
            CACHE_CONFIG.KEYS.PROGRAMS,
            'getProgramAktif',
            {},
            CACHE_CONFIG.DURATIONS.DYNAMIC
        );
        
        currentPrograms = programs;
        
        programSelect.innerHTML = '<option value="">Pilih Program...</option>' +
            currentPrograms.map(program => `
                <option value="${program.id_program}">
                    ${program.nama_program} - ${program.jenjang} (Rp ${program.harga.toLocaleString('id-ID')})
                </option>
            `).join('');
    } catch (error) {
        console.error('Error loading programs for registration:', error);
        programSelect.innerHTML = '<option value="">Gagal memuat program</option>';
    }
}

async function handlePrivateRegistration(e) {
    e.preventDefault();
    
    try {
        const formData = new FormData(e.target);
        
        const data = {
            nama_siswa: formData.get('nama_siswa'),
            jenis_kelamin: formData.get('jenis_kelamin'),
            alamat: formData.get('alamat'),
            tempat_lahir: formData.get('tempat_lahir'),
            tanggal_lahir: formData.get('tanggal_lahir'),
            jenjang: formData.get('jenjang'),
            kelas: formData.get('kelas'),
            nama_ortu: formData.get('nama_ortu'),
            no_hp_ortu: formData.get('no_hp_ortu'),
            pekerjaan_ortu: formData.get('pekerjaan_ortu'),
            program_daftar: document.getElementById('programSelect')?.value,
            jadwal_hari: Array.from(formData.getAll('jadwal_hari')),
            jadwal_jam: formData.get('jadwal_jam')
        };

        console.log('📤 Sending data to server:', data);

        if (!validasiFormPrivate(data)) {
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Mengirim...';
        
        const response = await callGoogleScript('simpanPendaftaranPrivate', data);
        
        if (response.success) {
            showSuccess(response.message || 'Pendaftaran berhasil! Kami akan menghubungi Anda dalam 1x24 jam.');
            e.target.reset();
            
            const programSelect = document.getElementById('programSelect');
            if (programSelect) programSelect.value = '';
            
            const initialMessage = document.getElementById('initialMessage');
            const privateForm = document.getElementById('privateForm');
            if (initialMessage) initialMessage.classList.remove('hidden');
            if (privateForm) privateForm.classList.add('hidden');
            
            const feedbackElement = document.getElementById('autoSelectFeedback');
            if (feedbackElement) feedbackElement.classList.add('hidden');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('❌ Error submitting form:', error);
        showError('Gagal mengirim pendaftaran: ' + error.message);
    } finally {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Pendaftaran';
        }
    }
}

async function handleGroupRegistration(e) {
    e.preventDefault();
    
    try {
        const formData = new FormData(e.target);
        
        const data = {
            nama_perwakilan: formData.get('nama_perwakilan'),
            asal_sekolah: formData.get('asal_sekolah'),
            jenjang: formData.get('jenjang'),
            kelas: formData.get('kelas'),
            jumlah_siswa: parseInt(formData.get('jumlah_siswa')),
            no_hp_perwakilan: formData.get('no_hp_perwakilan'),
            program_daftar: document.getElementById('programSelect')?.value,
            jadwal_hari: Array.from(formData.getAll('jadwal_hari')),
            jadwal_jam: formData.get('jadwal_jam')
        };

        console.log('📤 Sending group data to server:', data);

        if (!validasiFormGroup(data)) {
            return;
        }

        const submitBtn = e.target.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Mengirim...';
        
        const response = await callGoogleScript('simpanPendaftaranGroup', data);
        
        if (response.success) {
            showSuccess(response.message || 'Pendaftaran group berhasil! Kami akan menghubungi perwakilan dalam 1x24 jam.');
            e.target.reset();
            
            const programSelect = document.getElementById('programSelect');
            if (programSelect) programSelect.value = '';
            
            const initialMessage = document.getElementById('initialMessage');
            const groupForm = document.getElementById('groupForm');
            if (initialMessage) initialMessage.classList.remove('hidden');
            if (groupForm) groupForm.classList.add('hidden');
            
            const feedbackElement = document.getElementById('autoSelectFeedback');
            if (feedbackElement) feedbackElement.classList.add('hidden');
        } else {
            throw new Error(response.message);
        }
    } catch (error) {
        console.error('❌ Error submitting group form:', error);
        showError('Gagal mengirim pendaftaran: ' + error.message);
    } finally {
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Pendaftaran Group';
        }
    }
}

function setupGoogleDriveValidation() {
    const driveInputs = [
        { id: 'foto_url', type: 'foto' },
        { id: 'cv_url', type: 'cv' },
        { id: 'kesepakatan_kerja_url', type: 'kerja' }
    ];
    
    driveInputs.forEach(input => {
        const element = document.getElementById(input.id);
        if (element) {
            element.addEventListener('blur', function() {
                validateGoogleDriveLink(this, input.type);
            });
            
            if (element.value) {
                validateGoogleDriveLink(element, input.type);
            }
        }
    });
}

// ==================== 11. VALIDATION FUNCTIONS ====================

function validasiFormPrivate(data) {
    const requiredFields = [
        'nama_siswa', 'jenis_kelamin', 'alamat', 'tempat_lahir', 
        'tanggal_lahir', 'jenjang', 'kelas', 'nama_ortu', 'no_hp_ortu'
    ];
    
    for (let field of requiredFields) {
        if (!data[field] || data[field].toString().trim() === '') {
            showError(`Field ${field.replace('_', ' ')} harus diisi`);
            return false;
        }
    }
    
    if (!data.jadwal_hari || data.jadwal_hari.length === 0) {
        showError('Pilih minimal satu hari belajar');
        return false;
    }
    
    if (!data.jadwal_jam) {
        showError('Pilih jam belajar');
        return false;
    }
    
    const phoneRegex = /^[0-9+\-\s()]{10,15}$/;
    if (!phoneRegex.test(data.no_hp_ortu)) {
        showError('Format nomor HP tidak valid');
        return false;
    }
    
    return true;
}

function validasiFormGroup(data) {
    const requiredFields = [
        'nama_perwakilan', 'asal_sekolah', 'jenjang', 'kelas', 
        'jumlah_siswa', 'no_hp_perwakilan'
    ];
    
    for (let field of requiredFields) {
        if (!data[field] || data[field].toString().trim() === '') {
            showError(`Field ${field.replace('_', ' ')} harus diisi`);
            return false;
        }
    }
    
    if (!data.jadwal_hari || data.jadwal_hari.length === 0) {
        showError('Pilih minimal satu hari belajar');
        return false;
    }
    
    if (!data.jadwal_jam) {
        showError('Pilih jam belajar');
        return false;
    }
    
    if (data.jumlah_siswa < 2 || data.jumlah_siswa > 20) {
        showError('Jumlah siswa harus antara 2-20 orang');
        return false;
    }
    
    return true;
}

// ==================== 12. IMAGE FUNCTIONS ====================

function extractImageFromProgram(program) {
    console.log('🖼️ Mencari gambar untuk program:', program.nama_program);
    
    const possibleImageFields = [
        program['program.I'],
        program.H,
        program.gambar_program,
        program.gambar,
        program.image,
        program.url_gambar,
        program.link_gambar,
        program.foto,
        program.photo,
        program.img,
        program.picture
    ];
    
    console.log('🔍 Possible image fields:', possibleImageFields);
    
    for (const imageUrl of possibleImageFields) {
        if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '' && imageUrl.includes('http')) {
            console.log('✅ Found image URL:', imageUrl);
            
            if (imageUrl.includes('drive.google.com')) {
                const convertedUrl = convertGoogleDriveLink(imageUrl);
                console.log('🔄 Converted Google Drive URL:', convertedUrl);
                return convertedUrl;
            }
            
            return imageUrl;
        }
    }
    
    console.log('❌ No image URL found, using default');
    return getDefaultProgramImage(program.jenjang);
}

function convertGoogleDriveLink(originalUrl) {
    let fileId = '';
    
    const match1 = originalUrl.match(/\/d\/([^\/]+)/);
    if (match1) fileId = match1[1];
    
    const match2 = originalUrl.match(/[?&]id=([^&]+)/);
    if (match2) fileId = match2[1];
    
    if (fileId) {
        return `https://lh3.googleusercontent.com/d/${fileId}=w1000`;
    }
    
    return originalUrl;
}

function getDefaultProgramImage(jenjang) {
    const images = {
        'SD': 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiM0Q0FGNTAiLz4KPHRleHQgeD0iMjAwIiB5PSIxMDAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIj5Qcm9ncmFtIFNEPC90ZXh0Pgo8L3N2Zz4=',
        'SMP': 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiMyMTk2RjMiLz4KPHRleHQgeD0iMjAwIiB5PSIxMDAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIj5Qcm9ncmFtIFNNUDwvdGV4dD4KPC9zdmc+',
        'SMA': 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiM5QzI3QjAiLz4KPHRleHQgeD0iMjAwIiB5PSIxMDAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIj5Qcm9ncmFtIFNNQTwvdGV4dD4KPC9zdmc+'
    };
    
    return images[jenjang] || images.SD;
}

function getDefaultPromoImage() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNmNTllMGIiLz4KPHRleHQgeD0iMjAwIiB5PSIxMDAiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIyMCIgZmlsbD0id2hpdGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGFsaWdubWVudC1iYXNlbGluZT0ibWlkZGxlIj5Qcm9tb1NwZXNpYWw8L3RleHQ+Cjwvc3ZnPg==';
}

function getDefaultTestimonialImage() {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiMxNGI4YTYiLz4KPHRleHQgeD0iNTAiIHk9IjUwIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMTgiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBhbGlnbm1lbnQtYmFzZWxpbmU9Im1pZGRsZSI+U0M8L3RleHQ+Cjwvc3ZnPg==';
}

function extractImageForPromo(promo, program) {
    console.log('🖼️ Mencari gambar untuk promo:', promo.nama_promo);
    
    const possibleImageFields = [
        promo.gambar_promo,
        promo.J,
        promo.gambar,
        promo.image,
        promo.foto,
        promo.photo
    ];
    
    for (const imageUrl of possibleImageFields) {
        if (imageUrl && typeof imageUrl === 'string' && imageUrl.trim() !== '' && imageUrl.includes('http')) {
            console.log('✅ Found promo image URL:', imageUrl);
            
            if (imageUrl.includes('drive.google.com')) {
                return convertGoogleDriveLink(imageUrl);
            }
            
            return imageUrl;
        }
    }
    
    if (program) {
        const programImage = extractImageFromProgram(program);
        if (programImage && programImage.includes('http')) {
            return programImage;
        }
    }
    
    return getDefaultPromoImage();
}

// ==================== 13. BROSUR FUNCTIONS ====================

async function downloadBrosurProgram(programId, programName) {
    const button = event?.target;
    const originalText = button?.innerHTML || '📥 Brosur';
    
    try {
        if (button) {
            button.innerHTML = '⏳...';
            button.disabled = true;
        }
        
        console.log('🔄 Download brosur program:', { programId, programName });
        
        let program = currentPrograms?.find(p => p.id_program === programId);
        
        if (!program) {
            console.log('🔄 Program not found in cache, fetching fresh data...');
            const programs = await CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROGRAMS,
                'getProgramAktif',
                {},
                CACHE_CONFIG.DURATIONS.DYNAMIC
            );
            program = programs.find(p => p.id_program === programId);
        }
        
        if (!program) {
            throw new Error('Program tidak ditemukan');
        }
        
        const brosurUrl = findBrosurUrlForProgram(program);
        
        if (brosurUrl) {
            console.log('🎯 BROSUR FOUND:', brosurUrl);
            openDownloadLink(brosurUrl, `Brosur_${programName.replace(/\s+/g, '_')}.pdf`);
        } else {
            console.log('❌ No brosur URL found');
            handleNoBrosurAvailable(programName, 'program');
        }
        
    } catch (error) {
        console.error('❌ Error download brosur program:', error);
        showError('Gagal mengunduh brosur: ' + error.message);
    } finally {
        if (button) {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }
}

async function downloadBrosurPromo(promoId, promoName) {
    const button = event?.target;
    const originalText = button?.innerHTML || '📥 Brosur';
    
    try {
        if (button) {
            button.innerHTML = '⏳...';
            button.disabled = true;
        }
        
        console.log('🔄 Download brosur promo:', { promoId, promoName });
        
        let promo = currentPromos?.find(p => p.id_promo === promoId);
        
        if (!promo) {
            console.log('🔄 Promo not found in cache, fetching fresh data...');
            const promos = await CacheManager.loadWithCache(
                CACHE_CONFIG.KEYS.PROMOS,
                'getPromoAktif',
                {},
                CACHE_CONFIG.DURATIONS.SHORT
            );
            promo = promos.find(p => p.id_promo === promoId);
        }
        
        if (!promo) {
            throw new Error('Promo tidak ditemukan');
        }
        
        const brosurUrl = findBrosurUrlForPromo(promo);
        
        if (brosurUrl) {
            console.log('🎯 BROSUR FOUND:', brosurUrl);
            openDownloadLink(brosurUrl, `Brosur_Promo_${promoName.replace(/\s+/g, '_')}.pdf`);
        } else {
            console.log('❌ No brosur URL found');
            handleNoBrosurAvailable(promoName, 'promo');
        }
        
    } catch (error) {
        console.error('❌ Error download brosur promo:', error);
        showError('Gagal mengunduh brosur: ' + error.message);
    } finally {
        if (button) {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }
}

function findBrosurUrlForProgram(program) {
    console.log('🔍 Searching brosur for PROGRAM:', program.nama_program);
    
    if (program.link_brosur && program.link_brosur.trim() !== '') {
        const url = processBrosurUrl(program.link_brosur.trim());
        if (url) {
            console.log('✅ FOUND in link_brosur:', url);
            return url;
        }
    }
    
    if (program.brosur && program.brosur.trim() !== '') {
        const url = processBrosurUrl(program.brosur.trim());
        if (url) {
            console.log('✅ FOUND in brosur field:', url);
            return url;
        }
    }
    
    console.log('❌ Brosur tidak tersedia - link_brosur kosong');
    return null;
}

function findBrosurUrlForPromo(promo) {
    console.log('🔍 Searching brosur for PROMO:', promo.nama_promo);
    
    if (promo['promo.K'] && promo['promo.K'].trim() !== '') {
        const url = processBrosurUrl(promo['promo.K'].trim());
        if (url) {
            console.log('✅ FOUND in promo.K:', url);
            return url;
        }
    }
    
    if (promo.K && promo.K.trim() !== '') {
        const url = processBrosurUrl(promo.K.trim());
        if (url) {
            console.log('✅ FOUND in K field:', url);
            return url;
        }
    }
    
    if (promo.link_brosur && promo.link_brosur.trim() !== '') {
        const url = processBrosurUrl(promo.link_brosur.trim());
        if (url) {
            console.log('✅ FOUND in link_brosur:', url);
            return url;
        }
    }
    
    console.log('❌ Brosur tidak tersedia - promo.K kosong');
    return null;
}

function processBrosurUrl(url) {
    if (!url || url === '#' || url.trim() === '') return null;
    
    const trimmedUrl = url.trim();
    console.log('🔧 Processing URL:', trimmedUrl);
    
    if (trimmedUrl.startsWith('http')) {
        return trimmedUrl;
    }
    
    if (trimmedUrl.length > 10 && !trimmedUrl.includes(' ') && /^[a-zA-Z0-9_-]+$/.test(trimmedUrl)) {
        const driveUrl = `https://drive.google.com/uc?export=download&id=${trimmedUrl}`;
        console.log('🔄 Converted Drive ID to:', driveUrl);
        return driveUrl;
    }
    
    if ((trimmedUrl.includes('.') || trimmedUrl.includes('/')) && trimmedUrl.length > 5) {
        const fullUrl = trimmedUrl.startsWith('http') ? trimmedUrl : 'https://' + trimmedUrl;
        console.log('🔄 Converted partial URL to:', fullUrl);
        return fullUrl;
    }
    
    return null;
}

function handleNoBrosurAvailable(itemName, type = 'program') {
    const message = type === 'program' 
        ? `Brosur untuk "${itemName}" belum tersedia.\n\nApakah Anda ingin menghubungi admin untuk mendapatkan brosur?`
        : `Brosur untuk promo "${itemName}" belum tersedia.\n\nApakah Anda ingin menghubungi admin untuk mendapatkan brosur?`;
    
    const userChoice = confirm(message);
    
    if (userChoice) {
        const whatsappMessage = type === 'program'
            ? `Halo, saya ingin request brosur untuk program: ${itemName}`
            : `Halo, saya ingin request brosur untuk promo: ${itemName}`;
            
        const whatsappUrl = `https://wa.me/6285180649460?text=${encodeURIComponent(whatsappMessage)}`;
        window.open(whatsappUrl, '_blank');
    }
}

function openDownloadLink(url, filename) {
    try {
        const link = document.createElement('a');
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        
        if (url.includes('drive.google.com/uc?export=download') || 
            url.includes('.pdf') || 
            url.includes('.doc') || 
            url.includes('.jpg') || 
            url.includes('.png')) {
            link.download = filename || 'brosur.pdf';
        }
        
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showSuccess('Membuka brosur...');
        
    } catch (error) {
        console.error('❌ Error opening link:', error);
        window.open(url, '_blank');
    }
}

// ==================== 14. UTILITY FUNCTIONS ====================

function showLoading(container) {
    const isPrograms = container.id === 'programsContainer';
    const isTestimonials = container.id === 'testimonialsContainer';
    const isStats = container.id === 'statsContainer';
    
    if (isPrograms) {
        container.innerHTML = `
            <div class="skeleton-program-card skeleton-loading">
                <div class="skeleton-text" style="height: 1.5rem; width: 70%; margin-bottom: 1rem;"></div>
                <div class="skeleton-text short" style="margin-bottom: 1.5rem;"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text medium"></div>
                <div class="skeleton-button"></div>
            </div>
            <div class="skeleton-program-card skeleton-loading">
                <div class="skeleton-text" style="height: 1.5rem; width: 70%; margin-bottom: 1rem;"></div>
                <div class="skeleton-text short" style="margin-bottom: 1.5rem;"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text medium"></div>
                <div class="skeleton-button"></div>
            </div>
            <div class="skeleton-program-card skeleton-loading">
                <div class="skeleton-text" style="height: 1.5rem; width: 70%; margin-bottom: 1rem;"></div>
                <div class="skeleton-text short" style="margin-bottom: 1.5rem;"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text medium"></div>
                <div class="skeleton-button"></div>
            </div>
        `;
    } else if (isTestimonials) {
        container.innerHTML = `
            <div class="skeleton-testimonial-card skeleton-loading">
                <div class="skeleton-text" style="margin-bottom: 1rem;"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text medium" style="margin-bottom: 2rem;"></div>
                <div style="display: flex; align-items: center; gap: 1rem;">
                    <div class="skeleton-loading" style="width: 50px; height: 50px; border-radius: 50%;"></div>
                    <div style="flex: 1;">
                        <div class="skeleton-text short" style="margin-bottom: 0.5rem;"></div>
                        <div class="skeleton-text" style="width: 40%;"></div>
                    </div>
                </div>
            </div>
        `;
    } else if (isStats) {
        container.innerHTML = `
            <div class="stat-card skeleton-loading" style="min-height: 120px;"></div>
            <div class="stat-card skeleton-loading" style="min-height: 120px;"></div>
            <div class="stat-card skeleton-loading" style="min-height: 120px;"></div>
            <div class="stat-card skeleton-loading" style="min-height: 120px;"></div>
        `;
    } else {
        container.innerHTML = `
            <div class="loading-spinner">
                <div class="spinner"></div>
                <p>Memuat data...</p>
            </div>
        `;
    }
}

function showSuccess(message) {
    alert('✅ ' + message);
}

function showError(message) {
    alert('❌ ' + message);
}

function setupClassOptions() {
    const jenjangSelects = document.querySelectorAll('select[name="jenjang"]');
    const kelasSelects = document.querySelectorAll('select[name="kelas"]');
    
    jenjangSelects.forEach((jenjangSelect, index) => {
        const kelasSelect = kelasSelects[index];
        
        if (jenjangSelect && kelasSelect) {
            updateClassOptions(jenjangSelect, kelasSelect);
            
            jenjangSelect.addEventListener('change', function() {
                updateClassOptions(this, kelasSelect);
            });
        }
    });
}

function updateClassOptions(jenjangSelect, kelasSelect) {
    const jenjang = jenjangSelect.value;
    let classes = [];
    
    switch(jenjang) {
        case 'SD':
            classes = ['1', '2', '3', '4', '5', '6'];
            break;
        case 'SMP':
            classes = ['7', '8', '9'];
            break;
        case 'SMA':
            classes = ['10', '11', '12'];
            break;
        default:
            classes = [];
    }
    
    kelasSelect.innerHTML = '<option value="">Pilih Kelas</option>' +
        classes.map(cls => `<option value="${cls}">Kelas ${cls}</option>`).join('');
}

// ==================== 15. TUTOR FORM VALIDATION FUNCTIONS ====================

function validateGoogleDriveLink(input, fileType) {
    const statusElement = document.getElementById(`${fileType}_status`);
    const url = input.value.trim();
    
    if (!url) {
        if (statusElement) {
            statusElement.innerHTML = '';
            statusElement.className = '';
        }
        input.style.borderColor = '';
        return true;
    }
    
    if (isValidGoogleDriveLink(url)) {
        if (statusElement) {
            statusElement.innerHTML = '✅ Link Google Drive valid';
            statusElement.className = 'link-valid';
        }
        input.style.borderColor = 'var(--primary-teal)';
        return true;
    } else {
        if (statusElement) {
            statusElement.innerHTML = '❌ Format link tidak valid. Pastikan link dari Google Drive';
            statusElement.className = 'link-invalid';
        }
        input.style.borderColor = '#dc2626';
        return false;
    }
}

function isValidGoogleDriveLink(url) {
    if (!url || typeof url !== 'string') return false;
    
    const drivePatterns = [
        /drive\.google\.com\/file\/d\//,
        /drive\.google\.com\/uc\?id=/,
        /docs\.google\.com\/.*\/d\//,
        /drive\.google\.com\/open\?id=/
    ];
    
    return drivePatterns.some(pattern => pattern.test(url));
}

function resetLinkStatus() {
    ['foto', 'cv', 'kerja'].forEach(type => {
        const statusElement = document.getElementById(`${type}_status`);
        const inputElement = document.getElementById(`${type}_url`);
        if (statusElement) {
            statusElement.innerHTML = '';
            statusElement.className = '';
        }
        if (inputElement) inputElement.style.borderColor = '';
    });
}

// ==================== 16. TUTOR FORM SUBMISSION HANDLER ====================

function setupTutorEmailDetection() {
    const emailInput = document.getElementById('email');
    if (!emailInput) return;
    
    emailInput.addEventListener('blur', function() {
        const email = this.value.trim();
        if (email && isValidEmail(email)) {
            checkExistingTutor(email);
        }
    });
}

async function checkExistingTutor(email) {
    try {
        console.log('🔍 Checking existing tutor:', email);
        const response = await callGoogleScript('findTutorByEmail', { email: email });
        
        if (response.success && response.tutor) {
            showExistingTutorUI(response.tutor);
        } else {
            hideExistingTutorUI();
        }
    } catch (error) {
        console.log('Error checking tutor:', error);
        hideExistingTutorUI();
    }
}

function showExistingTutorUI(tutorData) {
    console.log('🎯 Tutor exists, showing smart UI');
    
    const messageDiv = document.getElementById('existingTutorMessage');
    messageDiv.innerHTML = `
        <div style="background: linear-gradient(135deg, #e8f5e8, #c8e6c9); padding: 1.5rem; border-radius: 10px; margin-bottom: 2rem; border-left: 4px solid #4caf50;">
            <h3 style="color: #2e7d32; margin-bottom: 1rem;">🎉 Welcome Back, ${tutorData.nama_lengkap}!</h3>
            <p style="color: #1b5e20; margin-bottom: 1rem;">
                Kami menemukan data Anda dalam sistem. Untuk lamaran ini:
            </p>
            <ul style="color: #1b5e20; margin-bottom: 1rem;">
                <li>✅ <strong>Dokumen menggunakan yang sudah ada</strong> (tidak perlu upload ulang)</li>
                <li>📝 Isi field dokumen hanya jika ingin update</li>
                <li>🔄 Data pribadi akan diperbarui otomatis</li>
            </ul>
            <small style="color: #388e3c;">Email terdaftar: ${tutorData.email}</small>
        </div>
    `;
    messageDiv.style.display = 'block';
    
    document.getElementById('documentsNotice').style.display = 'block';
    autoFillTutorData(tutorData);
}

function hideExistingTutorUI() {
    document.getElementById('existingTutorMessage').style.display = 'none';
    document.getElementById('documentsNotice').style.display = 'none';
}

function autoFillTutorData(tutorData) {
    const fieldsToAutoFill = {
        'nama_lengkap': tutorData.nama_lengkap,
        'jenis_kelamin': tutorData.jenis_kelamin,
        'alamat_domisili': tutorData.alamat_domisili,
        'pendidikan_terakhir': tutorData.pendidikan_terakhir,
        'instansi_pendidikan': tutorData.instansi_pendidikan,
        'jurusan': tutorData.jurusan
    };
    
    for (const [fieldId, value] of Object.entries(fieldsToAutoFill)) {
        const element = document.getElementById(fieldId);
        if (element && !element.value) {
            element.value = value || '';
        }
    }
}

function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

function setupTutorFormSubmission() {
    const form = document.getElementById('tutorRegistrationForm');
    if (!form) {
        console.log('❌ Tutor form not found');
        return;
    }
    
    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleTutorFormSubmission(this);
    });
}

async function handleTutorFormSubmission(form) {
    if (form.isSubmitting) {
        console.log('⚠️ Form already submitting, ignoring...');
        return;
    }
    
    form.isSubmitting = true;
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const progressDiv = document.getElementById('uploadProgress');
    const originalText = submitBtn.innerHTML;
    
    try {
        if (progressDiv) progressDiv.style.display = 'block';
        submitBtn.disabled = true;
        submitBtn.innerHTML = '⏳ Mengirim...';
        
        if (!await validateTutorForm(form)) {
            throw new Error('Validasi form gagal');
        }
        
        const formData = new FormData(form);
        const data = {};
        
        for (let [key, value] of formData.entries()) {
            data[key] = value;
        }
        
        const jenjangCheckboxes = form.querySelectorAll('input[name="jenjang_diajarkan"]:checked');
        data.jenjang_diajarkan = Array.from(jenjangCheckboxes).map(cb => cb.value).join(', ');
        
        const selectedKarirId = localStorage.getItem('selectedKarirId');
        if (selectedKarirId) {
            data.karir_id = selectedKarirId;
        }
        
        console.log('📤 Sending tutor data to server...');
        
        const response = await callGoogleScript('submitTutorRegistrationWithLinks', data);
        console.log('📨 Server response:', response);
        
        if (response.success) {
            let successMessage = response.message || 'Lamaran berhasil dikirim! Kami akan menghubungi Anda dalam 1x24 jam.';
            
            if (response.isExistingTutor) {
                showSuccess('🔄 ' + successMessage);
            } else {
                showSuccess('🎉 ' + successMessage);
            }
            
            form.reset();
            localStorage.removeItem('selectedKarirId');
            localStorage.removeItem('selectedKarirName');
            resetLinkStatus();
            hideExistingTutorUI();
            
            setTimeout(() => {
                window.location.href = 'karir.html';
            }, 3000);
            
        } else {
            throw new Error(response.message);
        }
        
    } catch (error) {
        console.error('❌ Error in tutor form submission:', error);
        showError('Gagal mengirim lamaran: ' + error.message);
    } finally {
        form.isSubmitting = false;
        
        if (progressDiv) progressDiv.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
}

async function validateTutorForm(form) {
    const requiredFields = [
        'nama_lengkap', 'jenis_kelamin', 'tanggal_lahir', 'alamat_domisili',
        'no_hp', 'email', 'pendidikan_terakhir', 'instansi_pendidikan',
        'jurusan', 'ipk', 'status_sekarang', 'pengalaman_mengajar',
        'kesediaan_mengajar', 'area_mengajar'
    ];
    
    for (let field of requiredFields) {
        const element = document.getElementById(field);
        if (!element || !element.value || !element.value.toString().trim()) {
            showError(`Field ${field.replace('_', ' ')} harus diisi!`);
            element?.focus();
            return false;
        }
    }
    
    const jenjangCheckboxes = document.querySelectorAll('input[name="jenjang_diajarkan"]:checked');
    if (jenjangCheckboxes.length === 0) {
        showError('Pilih minimal satu jenjang yang bisa diajarkan!');
        return false;
    }
    
    const pernyataan = document.querySelector('input[name="pernyataan_kebenaran"]');
    if (!pernyataan || !pernyataan.checked) {
        showError('Anda harus menyetujui pernyataan kebenaran data!');
        return false;
    }
    
    const fotoUrl = document.getElementById('foto_url')?.value;
    const cvUrl = document.getElementById('cv_url')?.value;
    const kerjaUrl = document.getElementById('kesepakatan_kerja_url')?.value;
    
    if (fotoUrl && !isValidGoogleDriveLink(fotoUrl)) {
        showError('Link foto tidak valid!');
        return false;
    }
    if (cvUrl && !isValidGoogleDriveLink(cvUrl)) {
        showError('Link CV tidak valid!');
        return false;
    }
    if (kerjaUrl && !isValidGoogleDriveLink(kerjaUrl)) {
        showError('Link kesepakatan kerja tidak valid!');
        return false;
    }
    
    return true;
}

function initializeTutorForm() {
    const form = document.getElementById('tutorRegistrationForm');
    if (form) {
        setupTutorFormSubmission();
        setupTutorEmailDetection();
        console.log('✅ Tutor form with smart detection initialized');
    } else {
        console.log('❌ Tutor form not found');
    }
    
    autoSelectKarirInForm();
}

function handleSimpleJamSelection(selectElement) {
    const selectedValue = selectElement.value;
    const catatanContainer = document.getElementById('jam_catatan_container');
    const hiddenInput = document.getElementById('jadwal_jam');
    
    if (selectedValue === 'other') {
        catatanContainer.style.display = 'block';
        hiddenInput.value = 'custom';
    } else if (selectedValue) {
        catatanContainer.style.display = 'none';
        hiddenInput.value = selectedValue;
    } else {
        catatanContainer.style.display = 'none';
        hiddenInput.value = '';
    }
}

// ==================== CACHE MONITORING ====================

function monitorCachePerformance() {
    setInterval(() => {
        const stats = CacheManager.getStats();
        if (stats.hits + stats.misses > 10) {
            console.group('📊 Cache Performance Monitor');
            console.log(`Hit Rate: ${stats.hitRate}%`);
            console.log(`Hits: ${stats.hits}, Misses: ${stats.misses}`);
            console.log(`Cache Size: ${stats.size} items`);
            console.log(`Batch Operations: ${stats.batchCount}`);
            console.groupEnd();
        }
    }, 30000);
}

monitorCachePerformance();

// Export untuk debugging
window.CacheManager = CacheManager;
window.ProgressManager = ProgressManager;

console.log('✅ FINAL SCRIPT WITH CACHE SYSTEM loaded successfully');