// The Cloud Functions for Firebase SDK to create Cloud Functions and setup triggers.
const functions = require('firebase-functions');

// The Firebase Admin SDK to access the Firebase Realtime Database. 
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const moment = require('moment');

const dateFormat = "YYYY/MM/DD HH:mm";
const flexibleHourDiff = 2;



/*
Sends notification to user which reservation that he published was picked
*/
exports.notifyOnPickedReservation = functions.database.ref('/users/{uid}/pickedReservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
        const userId = reservation.uid;
        const restaurant = reservation.restaurant;

        const notification = {
                title: "Your reservation to " + restaurant + " has been picked",
                body: "You earned 2 stars!"
            };
        
        return sendNotification(userId, notification)
            	.then(results => {
                    console.log("notifyOnPickedReservation Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnPickedReservation finished with error:", error);
                });
    });



/*
When a new reservation is published-
sends notification to user if there is a match
*/
exports.notifyOnMatch = functions.database.ref('/reservations/{pushId}')
    .onCreate(event => {
        const reservation = event.data.val();
		const notificationsPromises = [];

		const dateReservation = moment(reservation.date, dateFormat);
		const minDateStr = dateReservation.clone().subtract(flexibleHourDiff,'hours').format(dateFormat);
		const maxDateStr = dateReservation.clone().add(flexibleHourDiff,'hours').format(dateFormat);
		
        const notification = {
                title: "It's a match!",
                body: "New reservation matching your request was arrived"
       		};

        return admin.database().ref('/notificationRequests')
    			.orderByChild('date')
    			.startAt(minDateStr)
    			.endAt(maxDateStr)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(notificationReqSnap => {
  						const notificationReq = notificationReqSnap.val();
  						const userId = notificationReq.uid;
  						const isFlexible = notificationReq.isFlexible;
  						const dateMatch = true;
  						if(!isFlexible) {
							dateMatch = dateReservation.format(dateFormat) == notificationReq.date;
  						}
  						const restaurantMatch = reservation.restaurant == notificationReq.restaurant;
  						const numOfPeopleMatch = reservation.numOfPeople == notificationReq.numOfPeople;
  						const result = dateMatch && restaurantMatch && numOfPeopleMatch;
  						if(result){
  							console.log("found a match! , reservation of userId: ", userId);
  							notificationsPromises.push(sendNotification(userId, notification));
  						}
					});
					return Promise.all(notificationsPromises)
				})
				.then(results => {
                    console.log("notifyOnMatch Successfully finished");
                })
                .catch(error => {
                    console.log("notifyOnMatch finished with error:", error);
                });

    });



/*
If no one picked a reservation (the date field is 2 hours or less from current time),
sends a notification and move it to history
Running every 15 minutes
*/
exports.notifyAndMoveToHistoryReservationsCron = functions.https.onRequest((req,res) => {
	const latestDateToNotify = moment().add(4,'hours').format(dateFormat); //2 hours difference between server to local time
	const notificationPromises = [];
	
	return admin.database().ref('/reservations')
    			.orderByChild('date')
    			.endAt(latestDateToNotify)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(reservationSnap => {
    					const reservation = reservationSnap.val();
  						const notification = {
                			title: "Your reservation to " + reservation.restaurant + " Didn't picked",
                			body: "Don't forget to notify the restaurant you will not come"
            			};
  						notificationPromises.push(sendNotification(reservation.uid, notification));
					});
					console.log("Send notifications...");
					return Promise.all(notificationPromises)
				})
				.then(results => {
					return moveOldItemsToHistory('/reservations', '/historyReservations', latestDateToNotify);
                })
				.then(results => {
					res.send('OK');
                    console.log("notifyAndMoveToHistoryCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("notifyAndMoveToHistoryCron finished with error:", error);
                });
});



/*
Move to history notification requests
Running once a day
*/
exports.moveNotificationRequestsToHistoryCron = functions.https.onRequest((req,res) => {

	const latestDateToMove = moment().add(2,'hours').subtract(flexibleHourDiff,'hours').format(dateFormat); //2 hours difference between server to local time
	const promises = [];
	console.log("Moving to history notification requests before: ", latestDateToMove);

	return moveOldItemsToHistory('/notificationRequests', 'historyNotificationRequests', latestDateToMove)
				.then(results => {
					res.send('OK');
                    console.log("moveNotificationRequestsToHistoryCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("moveNotificationRequestsToHistoryCron finished with error:", error);
                });
});



/*
If latestDateToRemove < current time => decrease num of stars and update latestDateToRemove to month later (if there are more stars)
*/
exports.removeStarsCron = functions.https.onRequest((req,res) => {

	const latestDateToRemove = moment().add(2,'hours').format(dateFormat); //2 hours difference between server to local time
	const promises = [];

	return admin.database().ref('/users')
    			.orderByChild('starRemoveDate')
    			.endAt(latestDateToRemove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(userSnap => {
  						const user = userSnap.val();
  						const numOfStars = user.stars;
  						const userId = userSnap.key;
  						if(numOfStars > 0){
  							if(numOfStars == 1){
								promises.push(admin.database().ref('/users/' + userId + '/starRemoveDate').set(null));
  							}
  							else{
  								const updatedRemoveStarDate = moment(user.starRemoveDate, dateFormat).add(1,'months').format(dateFormat);
  								promises.push(admin.database().ref('/users/' + userId + '/starRemoveDate').set(updatedRemoveStarDate));
  							}
  							promises.push(admin.database().ref('/users/' + userId + '/stars').set(numOfStars-1));
  						}
  					});
  					console.log("Num of users that lost a star: ", promises.length/2);
					return Promise.all(promises);
				})
				.then(results => {
					res.send('OK');
                    console.log("removeStarsCron Successfully finished");
                })
                .catch(error => {
                	res.send(error);
                    console.log("removeStarsCron finished with error:", error);
                });
});




const moveOldItemsToHistory = (refToRemove, refToAdd, latestDateToMove) => {

	const promises = [];

	return admin.database().ref(refToRemove)
    			.orderByChild('date')
    			.endAt(latestDateToMove)
    			.once('value')
    			.then(snapshot => {
    				snapshot.forEach(itemSnap => {
  						const item = itemSnap.val();
  						const key = itemSnap.key;
  						promises.push(admin.database().ref(refToRemove + '/' + key).set(null));
  						promises.push(admin.database().ref(refToAdd + '/' + key).set(item));
  					});
  					console.log("Num of items moving to history: ", promises.length/2);
					return Promise.all(promises);
				})	
};




const sendNotification = (userId, notification) => {

	 const payload = {} ;
	 payload['notification'] = notification;

	return admin.database().ref(`/users/${userId}/instanceId`)
        		.once('value')
        		.then(result => {
            		const instanceId = result.val();
            		return admin.messaging().sendToDevice(instanceId, payload);
            	})
};






