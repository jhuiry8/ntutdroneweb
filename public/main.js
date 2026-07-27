// NTUT Drone Club Landing Page - Interactivity Script

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Lucide Icons
    lucide.createIcons();

    // 2. Sticky Navbar scroll handler
    const navbar = document.querySelector('.navbar');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // 3. Mobile Navigation Drawer
    const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
    const drawerClose = document.querySelector('.drawer-close');
    const mobileDrawer = document.querySelector('.mobile-drawer');
    const drawerLinks = document.querySelectorAll('.drawer-link');

    function openDrawer() {
        mobileDrawer.classList.add('active');
        document.body.style.overflow = 'hidden'; // Disable scroll background
    }

    function closeDrawer() {
        mobileDrawer.classList.remove('active');
        document.body.style.overflow = ''; // Re-enable scroll
    }

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', openDrawer);
    }
    if (drawerClose) {
        drawerClose.addEventListener('click', closeDrawer);
    }
    drawerLinks.forEach(link => {
        link.addEventListener('click', closeDrawer);
    });

    // 4. Hero Drone Mouse Parallax Effect
    const droneImg = document.getElementById('hero-drone');
    const heroSection = document.getElementById('home');

    if (droneImg && heroSection) {
        heroSection.addEventListener('mousemove', (e) => {
            const { width, height, left, top } = heroSection.getBoundingClientRect();
            const mouseX = e.clientX - left - width / 2;
            const mouseY = e.clientY - top - height / 2;
            
            // Limit the parallax tilt range
            const tiltX = (mouseY / (height / 2)) * -10; // Max 10 deg
            const tiltY = (mouseX / (width / 2)) * 10;   // Max 10 deg
            const moveX = (mouseX / (width / 2)) * 15;   // Max 15px
            const moveY = (mouseY / (height / 2)) * 15;  // Max 15px

            droneImg.style.transform = `translate(${moveX}px, ${moveY}px) rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
        });

        heroSection.addEventListener('mouseleave', () => {
            droneImg.style.transform = 'translate(0px, 0px) rotateX(0deg) rotateY(0deg)';
            droneImg.style.transition = 'transform 0.5s ease-out';
        });

        heroSection.addEventListener('mouseenter', () => {
            droneImg.style.transition = 'none';
        });
    }

    // 5. Stat Counter Animation
    const statsSection = document.querySelector('.stats-bar-section');
    const statNums = document.querySelectorAll('.stat-num');
    let animated = false;

    function startCounting() {
        statNums.forEach(num => {
            const target = +num.getAttribute('data-val');
            const duration = 1500; // 1.5 seconds
            const startTime = performance.now();

            function updateCounter(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                
                // Ease out quad
                const easeProgress = progress * (2 - progress);
                const currentVal = Math.floor(easeProgress * target);
                
                num.textContent = currentVal;

                if (progress < 1) {
                    requestAnimationFrame(updateCounter);
                } else {
                    num.textContent = target;
                }
            }

            requestAnimationFrame(updateCounter);
        });
    }

    if (statsSection && statNums.length > 0) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !animated) {
                    startCounting();
                    animated = true;
                }
            });
        }, { threshold: 0.5 });

        observer.observe(statsSection);
    }

    // 6. FAQ Accordion Action
    const faqCards = document.querySelectorAll('.faq-card');

    faqCards.forEach(card => {
        const question = card.querySelector('.faq-question');
        const answer = card.querySelector('.faq-answer');

        if (question && answer) {
            question.addEventListener('click', () => {
                const isActive = card.classList.contains('active');

                // Close other open cards
                faqCards.forEach(c => {
                    if (c !== card) {
                        c.classList.remove('active');
                        c.querySelector('.faq-answer').style.maxHeight = null;
                    }
                });

                // Toggle this card
                if (isActive) {
                    card.classList.remove('active');
                    answer.style.maxHeight = null;
                } else {
                    card.classList.add('active');
                    answer.style.maxHeight = answer.scrollHeight + 'px';
                }
            });
        }
    });

    // 7. Interactive Telemetry / Particle Background (Canvas)
    const canvas = document.getElementById('telemetry-bg');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let particles = [];
        let mouse = { x: null, y: null, radius: 150 };

        function resizeCanvas() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            initParticles();
        }

        window.addEventListener('resize', resizeCanvas);
        window.addEventListener('mousemove', (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });
        window.addEventListener('mouseleave', () => {
            mouse.x = null;
            mouse.y = null;
        });

        class Particle {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.size = Math.random() * 2 + 0.5;
                this.speedX = (Math.random() - 0.5) * 0.4;
                this.speedY = (Math.random() - 0.5) * 0.4;
                this.density = (Math.random() * 20) + 10;
            }

            draw() {
                ctx.fillStyle = 'rgba(0, 240, 255, 0.4)';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.closePath();
                ctx.fill();
            }

            update() {
                // Movement
                this.x += this.speedX;
                this.y += this.speedY;

                // Screen bounds loop
                if (this.x < 0) this.x = canvas.width;
                if (this.x > canvas.width) this.x = 0;
                if (this.y < 0) this.y = canvas.height;
                if (this.y > canvas.height) this.y = 0;

                // Mouse interaction (push away gently)
                if (mouse.x != null && mouse.y != null) {
                    let dx = mouse.x - this.x;
                    let dy = mouse.y - this.y;
                    let distance = Math.sqrt(dx * dx + dy * dy);
                    if (distance < mouse.radius) {
                        let forceDirectionX = dx / distance;
                        let forceDirectionY = dy / distance;
                        let force = (mouse.radius - distance) / mouse.radius;
                        let directionX = forceDirectionX * force * this.density * 0.3;
                        let directionY = forceDirectionY * force * this.density * 0.3;
                        this.x -= directionX;
                        this.y -= directionY;
                    }
                }
            }
        }

        function initParticles() {
            particles = [];
            const numberOfParticles = Math.floor((canvas.width * canvas.height) / 15000);
            for (let i = 0; i < numberOfParticles; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                particles.push(new Particle(x, y));
            }
        }

        function animateParticles() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Draw grid in background (cyberpunk telemetry look)
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.015)';
            ctx.lineWidth = 1;
            const gridSize = 80;
            for (let x = 0; x < canvas.width; x += gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (let y = 0; y < canvas.height; y += gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }

            particles.forEach(p => {
                p.update();
                p.draw();
            });
            connectParticles();
            requestAnimationFrame(animateParticles);
        }

        function connectParticles() {
            const maxDistance = 120;
            for (let a = 0; a < particles.length; a++) {
                for (let b = a; b < particles.length; b++) {
                    let dx = particles[a].x - particles[b].x;
                    let dy = particles[a].y - particles[b].y;
                    let distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < maxDistance) {
                        const alpha = (1 - (distance / maxDistance)) * 0.12;
                        ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
                        ctx.lineWidth = 0.5;
                        ctx.beginPath();
                        ctx.moveTo(particles[a].x, particles[a].y);
                        ctx.lineTo(particles[b].x, particles[b].y);
                        ctx.stroke();
                    }
                }
            }
        }

        resizeCanvas();
        animateParticles();
    }
});
