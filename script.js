// 전역 변수
let map;
let markers = [];
let sheltersData = [];
let infoWindows = [];
let currentLocation = null;

// CSV 파일 로드 및 파싱
async function loadSheltersData() {
    const statusDiv = document.getElementById('status');
    try {
        updateStatus('쉼터 데이터를 불러오는 중...', 'info');
        const response = await fetch('행정안전부_무더위쉼터.csv');
        const csvText = await response.text();
        
        // 간단한 CSV 파서
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
            if (values.length === headers.length) {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header] = values[index];
                });
                
                // 위도, 경도가 있는 데이터만 필터링
                if (obj['위도'] && obj['경도'] && !isNaN(obj['위도']) && !isNaN(obj['경도'])) {
                    sheltersData.push({
                        name: obj['쉼터명칭'] || '이름 없음',
                        address: obj['상세주소'] || '',
                        roadAddress: obj['도로명상세주소'] || '',
                        lat: parseFloat(obj['위도']),
                        lng: parseFloat(obj['경도']),
                        facilities: {
                            fans: parseInt(obj['냉방기보유선풍기']) || 0,
                            acs: parseInt(obj['냉방기보유에어컨']) || 0
                        },
                        hours: {
                            weekday: {
                                start: obj['평일운영시작시간'] || '0900',
                                end: obj['평일운영종료시간'] || '1800'
                            },
                            weekend: {
                                start: obj['주말휴일운영시작시간'] || '',
                                end: obj['주말휴일운영종료시간'] || ''
                            }
                        },
                        type: obj['시설유형 소분류'] || '기타',
                        area: obj['면적'] ? `${obj['면적']}㎡` : '정보 없음'
                    });
                }
            }
        }
        updateStatus(`총 ${sheltersData.length.toLocaleString()}개의 쉼터 데이터를 불러왔습니다.`, 'success');
        console.log('Loaded shelters:', sheltersData);
    } catch (error) {
        console.error('Error loading CSV:', error);
        updateStatus('쉼터 데이터를 불러오는데 실패했습니다.', 'error');
    }
}

// 상태 메시지 업데이트
function updateStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status-message ${type}`;
}

// Google Maps 초기화
function initMap() {
    const mapOptions = {
        center: { lat: 37.5665, lng: 126.9780 },
        zoom: 7,
        styles: [
            {
                "featureType": "administrative",
                "elementType": "labels.text.fill",
                "stylers": [{"color": "#444444"}]
            },
            {
                "featureType": "landscape",
                "elementType": "all",
                "stylers": [{"color": "#f2f2f2"}]
            },
            {
                "featureType": "poi",
                "elementType": "all",
                "stylers": [{"visibility": "off"}]
            },
            {
                "featureType": "road",
                "elementType": "all",
                "stylers": [{"saturation": -100}, {"lightness": 45}]
            },
            {
                "featureType": "road.highway",
                "elementType": "all",
                "stylers": [{"visibility": "simplified"}]
            },
            {
                "featureType": "road.arterial",
                "elementType": "labels.icon",
                "stylers": [{"visibility": "off"}]
            },
            {
                "featureType": "transit",
                "elementType": "all",
                "stylers": [{"visibility": "off"}]
            },
            {
                "featureType": "water",
                "elementType": "all",
                "stylers": [{"color": "#4a90e2"}, {"visibility": "on"}]
            }
        ]
    };
    
    map = new google.maps.Map(document.getElementById('map'), mapOptions);
    
    // 지도 로드 완료 후 오버레이 숨기기
    setTimeout(() => {
        document.getElementById('mapOverlay').style.display = 'none';
    }, 1000);
}

// 주소를 좌표로 변환
function getAddressCoords(address) {
    return new Promise((resolve, reject) => {
        const geocoder = new google.maps.Geocoder();
        
        geocoder.geocode({ address: address }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                resolve({
                    lat: location.lat(),
                    lng: location.lng(),
                    address: results[0].formatted_address
                });
            } else {
                reject('주소를 찾을 수 없습니다. 정확한 주소를 입력해주세요.');
            }
        });
    });
}

// 거리 계산 함수
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// 마커 표시 함수
function displayMarkers(userLat, userLng, nearbyShelters) {
    // 기존 마커와 InfoWindow 제거
    markers.forEach(marker => marker.setMap(null));
    infoWindows.forEach(infoWindow => infoWindow.close());
    markers = [];
    infoWindows = [];
    
    // 사용자 위치 마커
    const userPosition = { lat: userLat, lng: userLng };
    const userMarker = new google.maps.Marker({
        position: userPosition,
        map: map,
        title: '검색 위치',
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: "#4361ee",
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 3,
        },
        zIndex: 1000
    });
    
    const userInfoWindow = new google.maps.InfoWindow({
        content: `<div style="padding:10px;font-weight:bold;color:#4361ee;">검색 위치</div>`
    });
    
    userMarker.addListener('click', () => {
        userInfoWindow.open(map, userMarker);
    });
    
    markers.push(userMarker);
    infoWindows.push(userInfoWindow);
    
    // 쉼터 마커들
    nearbyShelters.forEach((shelter, index) => {
        const markerPosition = { lat: shelter.lat, lng: shelter.lng };
        const marker = new google.maps.Marker({
            position: markerPosition,
            map: map,
            title: shelter.name,
            label: {
                text: (index + 1).toString(),
                color: "#ffffff",
                fontSize: "12px",
                fontWeight: "bold"
            },
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#f87171",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2,
            }
        });
        
        const infoContent = `
            <div style="padding:10px;max-width:250px;">
                <div style="font-weight:bold;color:#f87171;margin-bottom:5px;">${shelter.name}</div>
                <div style="font-size:12px;margin-bottom:5px;">${shelter.roadAddress || shelter.address}</div>
                <div style="font-size:11px;color:#666;margin-bottom:5px;">
                    ${shelter.hours.weekday.start}-${shelter.hours.weekday.end}
                </div>
                <div style="font-size:11px;color:#4361ee;">
                    <i class="fas fa-fan"></i> ${shelter.facilities.fans}대 
                    <i class="fas fa-wind"></i> ${shelter.facilities.acs}대
                </div>
            </div>
        `;
        
        const infoWindow = new google.maps.InfoWindow({
            content: infoContent
        });
        
        marker.addListener('click', () => {
            infoWindow.open(map, marker);
        });
        
        markers.push(marker);
        infoWindows.push(infoWindow);
    });
    
    // 지도 중심 이동 및 줌 조정
    map.setCenter(userPosition);
    if(nearbyShelters.length > 0) {
        const distanceToFirst = calculateDistance(userLat, userLng, nearbyShelters[0].lat, nearbyShelters[0].lng);
        let zoomLevel = 14;
        if(distanceToFirst > 20) zoomLevel = 11;
        else if(distanceToFirst > 10) zoomLevel = 12;
        else if(distanceToFirst > 5) zoomLevel = 13;
        map.setZoom(zoomLevel);
    }
}

// 쉼터 리스트 표시 함수
function displaySheltersList(nearbyShelters) {
    const container = document.getElementById('sheltersContainer');
    const countDiv = document.getElementById('resultsCount');
    
    if (nearbyShelters.length === 0) {
        container.innerHTML = `
            <div class="placeholder-message">
                <i class="fas fa-search"></i>
                <p>해당 지역 근처에 등록된 쉼터가 없습니다.<br>다른 지역을 검색해보세요.</p>
            </div>
        `;
        countDiv.textContent = '0개';
        return;
    }
    
    countDiv.textContent = `${nearbyShelters.length}개`;
    
    container.innerHTML = nearbyShelters.map((shelter, index) => `
        <div class="shelter-item">
            <h3>
                <span style="margin-right: 8px; color: #f87171;">${index + 1}.</span>
                ${shelter.name}
            </h3>
            
            <div class="shelter-meta">
                <div class="meta-item">
                    <i class="fas fa-map-marker-alt"></i>
                    <span>${(shelter.distance || 0).toFixed(2)}km</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-clock"></i>
                    <span>${shelter.hours.weekday.start}-${shelter.hours.weekday.end}</span>
                </div>
                <div class="meta-item">
                    <i class="fas fa-ruler-combined"></i>
                    <span>${shelter.area}</span>
                </div>
            </div>
            
            <div class="shelter-details">
                <div class="shelter-address">
                    <i class="fas fa-location-dot"></i>
                    <span>${shelter.roadAddress || shelter.address || '주소 정보 없음'}</span>
                </div>
            </div>
            
            <div class="shelter-facilities">
                <span class="facility-tag">
                    <i class="fas fa-fan"></i> 선풍기 ${shelter.facilities.fans}대
                </span>
                <span class="facility-tag">
                    <i class="fas fa-wind"></i> 에어컨 ${shelter.facilities.acs}대
                </span>
            </div>
        </div>
    `).join('');
}

// 근처 쉼터 찾기
function findNearbyShelters(userLat, userLng, maxResults = 15) {
    const sheltersWithDistance = sheltersData.map(shelter => {
        const distance = calculateDistance(userLat, userLng, shelter.lat, shelter.lng);
        return { ...shelter, distance: distance };
    });
    
    // 거리순 정렬
    sheltersWithDistance.sort((a, b) => a.distance - b.distance);
    
    // 상위 N개만 반환
    return sheltersWithDistance.slice(0, maxResults);
}

// 검색 버튼 이벤트
document.getElementById('searchBtn').addEventListener('click', async function() {
    const input = document.getElementById('locationInput').value.trim();
    const statusDiv = document.getElementById('status');
    
    if (!input) {
        updateStatus('지역을 입력해주세요.', 'error');
        return;
    }
    
    updateStatus('주소를 찾는 중...', 'info');
    
    try {
        // 1. 주소 -> 좌표 변환
        const coords = await getAddressCoords(input);
        updateStatus(`"${coords.address}" 위치를 찾았습니다.`, 'success');
        
        // 2. 근처 쉼터 찾기
        const nearbyShelters = findNearbyShelters(coords.lat, coords.lng, 15);
        
        // 3. 지도에 마커 표시
        displayMarkers(coords.lat, coords.lng, nearbyShelters);
        
        // 4. 리스트에 표시
        displaySheltersList(nearbyShelters);
        
    } catch (error) {
        console.error('Error:', error);
        updateStatus(error, 'error');
    }
});

// Enter 키로도 검색 가능
document.getElementById('locationInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('searchBtn').click();
    }
});

// 페이지 로드 시 초기화
window.initMap = function() {
    initMap();
    loadSheltersData();
    
    // 초기 상태 메시지
    updateStatus('지역을 입력하고 검색 버튼을 클릭하세요.', 'info');
};